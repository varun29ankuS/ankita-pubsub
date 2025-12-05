/**
 * Ankita PubSub System - Consumer Groups
 *
 * Implements Kafka-like consumer groups for load balancing message
 * consumption across multiple subscribers.
 */

import type { Message, Subscriber } from './types';
import { database } from '../storage/database';

export type LoadBalanceStrategy = 'round-robin' | 'sticky' | 'broadcast' | 'random';

export interface ConsumerGroup {
  name: string;
  topic: string;
  strategy: LoadBalanceStrategy;
  members: ConsumerGroupMember[];
  createdAt: number;
  currentOffset: number;
  committedOffset: number;
}

export interface ConsumerGroupMember {
  subscriberId: string;
  clientId: string;
  joinedAt: number;
  lastHeartbeat: number;
  assignedPartitions: number[];
  messagesProcessed: number;
  isLeader: boolean;
}

export class ConsumerGroupManager {
  private groups: Map<string, ConsumerGroup> = new Map();
  private memberToGroup: Map<string, string> = new Map();
  private roundRobinIndex: Map<string, number> = new Map();
  private stickyAssignments: Map<string, string> = new Map(); // messageKey -> subscriberId

  constructor() {
    // Load existing consumer groups from database
    this.loadFromDatabase();

    // Start heartbeat checker
    setInterval(() => this.checkHeartbeats(), 10000);
  }

  private loadFromDatabase(): void {
    const groups = database.getAllConsumerGroups();
    for (const group of groups) {
      this.groups.set(group.name, {
        name: group.name,
        topic: group.topic,
        strategy: group.strategy as LoadBalanceStrategy,
        members: [],
        createdAt: group.created_at,
        currentOffset: group.current_offset,
        committedOffset: group.committed_offset,
      });
    }
  }

  /**
   * Create a new consumer group
   */
  createGroup(name: string, topic: string, strategy: LoadBalanceStrategy = 'round-robin'): ConsumerGroup {
    if (this.groups.has(name)) {
      throw new Error(`Consumer group '${name}' already exists`);
    }

    const group: ConsumerGroup = {
      name,
      topic,
      strategy,
      members: [],
      createdAt: Date.now(),
      currentOffset: 0,
      committedOffset: 0,
    };

    this.groups.set(name, group);
    database.createConsumerGroup(name, topic, strategy);

    return group;
  }

  /**
   * Join a consumer group
   */
  joinGroup(groupName: string, subscriberId: string, clientId: string): ConsumerGroupMember {
    const group = this.groups.get(groupName);
    if (!group) {
      throw new Error(`Consumer group '${groupName}' not found`);
    }

    // Check if already a member
    let member = group.members.find(m => m.subscriberId === subscriberId);
    if (member) {
      member.lastHeartbeat = Date.now();
      return member;
    }

    // Create new member
    member = {
      subscriberId,
      clientId,
      joinedAt: Date.now(),
      lastHeartbeat: Date.now(),
      assignedPartitions: [],
      messagesProcessed: 0,
      isLeader: group.members.length === 0, // First member becomes leader
    };

    group.members.push(member);
    this.memberToGroup.set(subscriberId, groupName);

    // Rebalance partitions
    this.rebalance(groupName);

    return member;
  }

  /**
   * Leave a consumer group
   */
  leaveGroup(subscriberId: string): void {
    const groupName = this.memberToGroup.get(subscriberId);
    if (!groupName) return;

    const group = this.groups.get(groupName);
    if (!group) return;

    const memberIndex = group.members.findIndex(m => m.subscriberId === subscriberId);
    if (memberIndex === -1) return;

    const wasLeader = group.members[memberIndex].isLeader;
    group.members.splice(memberIndex, 1);
    this.memberToGroup.delete(subscriberId);

    // Elect new leader if needed
    if (wasLeader && group.members.length > 0) {
      group.members[0].isLeader = true;
    }

    // Rebalance partitions
    this.rebalance(groupName);
  }

  /**
   * Get the next subscriber to receive a message based on load balancing strategy
   */
  getNextSubscriber(groupName: string, message: Message): string | null {
    const group = this.groups.get(groupName);
    if (!group || group.members.length === 0) {
      return null;
    }

    switch (group.strategy) {
      case 'round-robin':
        return this.roundRobinSelect(group);

      case 'sticky':
        return this.stickySelect(group, message);

      case 'random':
        return this.randomSelect(group);

      case 'broadcast':
        return null; // Special case - handled by caller

      default:
        return this.roundRobinSelect(group);
    }
  }

  /**
   * Get all subscribers for broadcast
   */
  getAllSubscribers(groupName: string): string[] {
    const group = this.groups.get(groupName);
    if (!group) return [];
    return group.members.map(m => m.subscriberId);
  }

  private roundRobinSelect(group: ConsumerGroup): string {
    let index = this.roundRobinIndex.get(group.name) || 0;
    const member = group.members[index % group.members.length];
    this.roundRobinIndex.set(group.name, index + 1);
    return member.subscriberId;
  }

  private stickySelect(group: ConsumerGroup, message: Message): string {
    // Use a key from the message for sticky assignment
    const stickyKey = this.getStickyKey(message);

    let assignedSubscriber = this.stickyAssignments.get(stickyKey);

    // Check if assigned subscriber is still in the group
    if (assignedSubscriber && group.members.some(m => m.subscriberId === assignedSubscriber)) {
      return assignedSubscriber;
    }

    // Assign to a member based on hash
    const hash = this.hashCode(stickyKey);
    const memberIndex = Math.abs(hash) % group.members.length;
    assignedSubscriber = group.members[memberIndex].subscriberId;
    this.stickyAssignments.set(stickyKey, assignedSubscriber);

    return assignedSubscriber;
  }

  private randomSelect(group: ConsumerGroup): string {
    const index = Math.floor(Math.random() * group.members.length);
    return group.members[index].subscriberId;
  }

  private getStickyKey(message: Message): string {
    // Try to get a key from common fields
    const payload = message.payload as any;

    if (payload?.userId) return `user:${payload.userId}`;
    if (payload?.orderId) return `order:${payload.orderId}`;
    if (payload?.sessionId) return `session:${payload.sessionId}`;
    if (message.correlationId) return `correlation:${message.correlationId}`;

    // Fall back to publisher ID
    return `publisher:${message.publisherId}`;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Rebalance partitions among members
   */
  private rebalance(groupName: string): void {
    const group = this.groups.get(groupName);
    if (!group) return;

    // For now, simple even distribution
    const numPartitions = 16; // Virtual partitions
    const numMembers = group.members.length;

    if (numMembers === 0) return;

    const partitionsPerMember = Math.floor(numPartitions / numMembers);
    const remainder = numPartitions % numMembers;

    let partitionIndex = 0;
    for (let i = 0; i < numMembers; i++) {
      const extra = i < remainder ? 1 : 0;
      const count = partitionsPerMember + extra;

      group.members[i].assignedPartitions = [];
      for (let j = 0; j < count; j++) {
        group.members[i].assignedPartitions.push(partitionIndex++);
      }
    }
  }

  /**
   * Update member heartbeat
   */
  heartbeat(subscriberId: string): void {
    const groupName = this.memberToGroup.get(subscriberId);
    if (!groupName) return;

    const group = this.groups.get(groupName);
    if (!group) return;

    const member = group.members.find(m => m.subscriberId === subscriberId);
    if (member) {
      member.lastHeartbeat = Date.now();
    }
  }

  /**
   * Record that a member processed a message
   */
  recordProcessed(subscriberId: string): void {
    const groupName = this.memberToGroup.get(subscriberId);
    if (!groupName) return;

    const group = this.groups.get(groupName);
    if (!group) return;

    const member = group.members.find(m => m.subscriberId === subscriberId);
    if (member) {
      member.messagesProcessed++;
    }
  }

  /**
   * Commit offset for a consumer group
   */
  commitOffset(groupName: string, offset: number): void {
    const group = this.groups.get(groupName);
    if (!group) return;

    group.committedOffset = offset;
    database.commitConsumerGroupOffset(groupName, offset);
  }

  /**
   * Get consumer group
   */
  getGroup(name: string): ConsumerGroup | undefined {
    return this.groups.get(name);
  }

  /**
   * Get all consumer groups
   */
  getAllGroups(): ConsumerGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Get group for a subscriber
   */
  getGroupForSubscriber(subscriberId: string): ConsumerGroup | undefined {
    const groupName = this.memberToGroup.get(subscriberId);
    return groupName ? this.groups.get(groupName) : undefined;
  }

  /**
   * Check for dead members (missed heartbeats)
   */
  private checkHeartbeats(): void {
    const timeout = 30000; // 30 seconds
    const now = Date.now();

    for (const group of this.groups.values()) {
      const deadMembers = group.members.filter(m => now - m.lastHeartbeat > timeout);

      for (const member of deadMembers) {
        console.log(`Consumer ${member.subscriberId} timed out from group ${group.name}`);
        this.leaveGroup(member.subscriberId);
      }
    }
  }

  /**
   * Delete a consumer group
   */
  deleteGroup(name: string): boolean {
    const group = this.groups.get(name);
    if (!group) return false;

    // Remove all member mappings
    for (const member of group.members) {
      this.memberToGroup.delete(member.subscriberId);
    }

    this.groups.delete(name);
    this.roundRobinIndex.delete(name);

    return true;
  }

  /**
   * Get group statistics
   */
  getStats(): any {
    const stats = {
      totalGroups: this.groups.size,
      totalMembers: 0,
      groupDetails: [] as any[],
    };

    for (const group of this.groups.values()) {
      stats.totalMembers += group.members.length;
      stats.groupDetails.push({
        name: group.name,
        topic: group.topic,
        strategy: group.strategy,
        memberCount: group.members.length,
        currentOffset: group.currentOffset,
        committedOffset: group.committedOffset,
        lag: group.currentOffset - group.committedOffset,
      });
    }

    return stats;
  }
}

// Singleton instance
export const consumerGroupManager = new ConsumerGroupManager();
