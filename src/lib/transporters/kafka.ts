import { GenericObject } from '@/typings';
import BaseTransporter from './base';
import { Kafka, Producer, Consumer, Admin } from 'kafkajs';
import _ from 'lodash';
import { PacketTypes } from '@/typings/packets';
import C from '../star/constants';

export default class KafkaTransporter extends BaseTransporter {
  public client: Kafka | null;
  public producer: Producer | null;
  public consumer: Consumer | null;
  public admin: Admin | null;
  private subscribedTopics: GenericObject[] = [];
  private consumerRecoveryPromise: Promise<void> | null = null;
  private consumerRecoveryTimer: NodeJS.Timeout | null = null;
  private resolveConsumerRecoveryDelay: ((shouldRecover: boolean) => void) | null = null;
  private consumerRecoveryAttempts = 0;
  private consumerRecoveryId = 0;
  private consumerRecoveryGeneration = 0;
  private consumerStopping = false;
  private consumerLastHeartbeatAt = 0;
  private consumerHealthTimer: NodeJS.Timeout | null = null;
  private consumerKafkaJsRestartGeneration: number | null = null;
  private consumerKafkaJsRestartTimer: NodeJS.Timeout | null = null;
  private retiredConsumers = new WeakSet<Consumer>();

  constructor(options: any) {
    if (typeof options === 'string') {
      options = { brokers: [options.replace('kafka://', '')] };
    } else if (options == null) {
      options = {};
    }

    // 处理嵌套的options结构
    let kafkaOptions = options.options || {};

    // 合并外层和内层配置
    const mergedOptions = {
      ...options,
      ...kafkaOptions,
      brokers: options.host ? [options.host] : kafkaOptions.brokers || ['localhost:9092'],
      ssl: kafkaOptions.ssl !== undefined ? kafkaOptions.ssl : false,
      sasl: kafkaOptions.sasl || null
    };

    options = _.defaultsDeep(mergedOptions, {
      brokers: ['localhost:9092'],
      clientId: 'node-universe-kafka-client',
      ssl: false,
      sasl: null,
      connectionTimeout: 3000,
      requestTimeout: 30000,
      logLevel: 'NOTHING', // 默认禁用kafkajs内部日志
      producer: {
        maxInFlightRequests: 1,
        idempotent: false,
        transactionTimeout: 30000
      },
      consumer: {
        groupId: 'node-universe-group',
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        recoveryBaseDelay: 1000,
        recoveryMaxDelay: 30000,
        healthCheckInterval: 30000,
        heartbeatTimeout: 120000,
        kafkaJsRestartTimeout: 30000
      },
      publish: {
        partition: 0
      }
    });

    super(options);

    this.client = null;
    this.producer = null;
    this.consumer = null;
    this.admin = null;
  }

  /**
   * 连接
   */
  public async connect(): Promise<void> {
    try {
      // 创建kafka实例
      const kafkaConfig: any = {
        clientId: this.options.clientId,
        brokers: this.options.brokers,
        connectionTimeout: this.options.connectionTimeout,
        requestTimeout: this.options.requestTimeout
      };

      // 添加SSL配置
      if (this.options.ssl) {
        kafkaConfig.ssl = this.options.ssl;
      }

      // 添加SASL认证配置
      if (this.options.sasl) {
        kafkaConfig.sasl = this.options.sasl;
      }

      // 添加日志级别配置，禁用kafkajs内部日志
      const { logLevel } = require('kafkajs');
      const logLevelMap = {
        NOTHING: logLevel.NOTHING,
        ERROR: logLevel.ERROR,
        WARN: logLevel.WARN,
        INFO: logLevel.INFO,
        DEBUG: logLevel.DEBUG
      };
      kafkaConfig.logLevel = logLevelMap[this.options.logLevel] || logLevel.NOTHING;

      this.client = new Kafka(kafkaConfig);

      // 创建生产者
      this.producer = this.client.producer(this.options.producer);

      // 创建管理员客户端
      this.admin = this.client.admin();

      // 连接生产者
      await this.producer.connect();

      // 连接管理员客户端
      await this.admin.connect();

      this.logger?.info('Kafka client is connected.');
      await this.onConnected();
    } catch (error: any) {
      this.logger?.error('Kafka Producer error', error.message);
      this.logger?.debug('Kafka Producer error', error);
      // 广播错误
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });
      throw error;
    }
  }

  /**
   * 断开连接
   */
  public async disconnect(): Promise<void> {
    this.consumerStopping = true;
    this.consumerRecoveryGeneration += 1;
    this.cancelConsumerRecovery();
    this.stopConsumerHealthCheck();
    this.stopKafkaJsRestartWatchdog();
    try {
      if (this.producer) {
        await this.producer.disconnect();
        this.producer = null;
      }

      if (this.consumer) {
        const consumer = this.consumer;
        this.consumer = null;
        await this.disconnectConsumer(consumer);
      }

      if (this.admin) {
        await this.admin.disconnect();
        this.admin = null;
      }

      this.client = null;
      this.connected = false;
    } catch (error: any) {
      this.logger?.error('Kafka disconnect error', error.message);
    }
  }

  /**
   * 订阅动作 - 使用通配符模式动态发现并订阅所有匹配的topics
   */
  public async makeSubscriptions(topics: GenericObject[]): Promise<void> {
    this.subscribedTopics = topics.map((topic) => ({ ...topic }));
    this.consumerStopping = false;

    try {
      // 使用管理员客户端尽力创建当前实例的 topics；本地开发环境下 Kafka metadata 偶发超时不应阻塞消费者订阅
      if (this.admin) {
          void this.ensureTopics(this.subscribedTopics);
        }

      await this.createConsumer(this.subscribedTopics, false);
    } catch (error: any) {
      this.logger?.error('Unable to create topics or setup consumer!', topics, error);
      // 广播错误
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_TOPIC_CREATION
      });
      throw error;
    }
  }

  private async ensureTopics(topics: GenericObject[]): Promise<void> {
    if (!this.admin) return;
    const currentTopicsMap = topics.map(({ cmd, nodeID }) => this.getTopicName(cmd, nodeID));
    try {
      await this.admin.createTopics({
        topics: currentTopicsMap.map((topic) => ({
          topic,
          numPartitions: 1,
          replicationFactor: 1
        }))
      });
    } catch (error: any) {
      this.logger?.warn('Kafka topic creation skipped or delayed', error?.message || error);
    }
  }

  private getConsumerGroupId(): string {
    return this.star?.instanceID || this.options.consumer.groupId || 'node-universe-group';
  }

  private isCurrentConsumer(consumer: Consumer, generation: number): boolean {
    return !this.consumerStopping && this.consumer === consumer && this.consumerRecoveryGeneration === generation;
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.consumerStopping && this.consumerRecoveryGeneration === generation;
  }

  private lifecyclePayload(reason: string, generation: number, details: GenericObject = {}): GenericObject {
    return {
      transporter: 'kafka',
      instanceID: this.star?.instanceID || null,
      groupId: this.getConsumerGroupId(),
      generation,
      reason,
      ...details
    };
  }

  private emitConsumerLifecycle(event: string, reason: string, generation: number, details: GenericObject = {}): void {
    this.star?.broadcastLocal(event, this.lifecyclePayload(reason, generation, details));
  }

  private errorSummary(error: unknown): GenericObject {
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'Error', message: String(error) };
  }

  private async disconnectConsumer(consumer: Consumer): Promise<void> {
    if (this.retiredConsumers.has(consumer)) return;
    this.retiredConsumers.add(consumer);
    try {
      await consumer.disconnect();
    } catch (error: any) {
      this.logger?.warn('Kafka consumer cleanup failed', error?.message || error);
    }
  }

  private async createConsumer(topics: GenericObject[], wasRecovery: boolean): Promise<void> {
    if (!this.client) throw new Error('Kafka client is unavailable for consumer subscription');
    const currentTopicsMap = topics.map(({ cmd, nodeID }) => this.getTopicName(cmd, nodeID));
    const uniqueCmds = [...new Set(topics.map(({ cmd }) => cmd))];
    const consumerOptions = Object.assign({}, this.options.consumer, {
      groupId: this.getConsumerGroupId()
    });
    const generation = ++this.consumerRecoveryGeneration;
    const consumer = this.client.consumer(consumerOptions);

    this.logger?.info(`Kafka Consumer starting with Group ID: ${consumerOptions.groupId}`);
    const supportsHeartbeatInstrumentation = this.attachConsumerLifecycle(consumer, generation);
    this.consumer = consumer;
    try {
      await consumer.connect();
      if (!this.isCurrentConsumer(consumer, generation)) return;
      await Promise.all(currentTopicsMap.map((topic) => consumer.subscribe({ topic, fromBeginning: false })));
      if (!this.isCurrentConsumer(consumer, generation)) return;
      await consumer.run({
        eachMessage: async ({ topic: messageTopic, message }) => {
          try {
            if (!this.isCurrentConsumer(consumer, generation) || !messageTopic.startsWith(this.prefix + '.')) return;
            const withoutPrefix = messageTopic.slice(this.prefix.length + 1);
            const firstDotIndex = withoutPrefix.indexOf('.');
            const cmd = (firstDotIndex === -1 ? withoutPrefix : withoutPrefix.substring(0, firstDotIndex)) as PacketTypes;
            if (message.value && uniqueCmds.includes(cmd)) this.receive(cmd, message.value as Buffer);
          } catch (error: any) {
            this.logger?.error('Error processing message', error);
          }
        }
      });
      if (!this.isCurrentConsumer(consumer, generation)) return;
      this.consumerLastHeartbeatAt = Date.now();
      if (supportsHeartbeatInstrumentation) this.startConsumerHealthCheck(generation, consumerOptions.groupId, consumer);
      this.consumerRecoveryAttempts = 0;
      this.logger?.info(
        `KAFKA Consumer connected and subscribed to topics: ${currentTopicsMap.join(', ')} with GroupID: ${consumerOptions.groupId}`
      );
      if (wasRecovery && this.isCurrentConsumer(consumer, generation)) await this.onConnected(true);
    } catch (error) {
      if (this.consumer === consumer && this.consumerRecoveryGeneration === generation) {
        this.consumer = null;
        this.consumerRecoveryGeneration += 1;
        this.stopConsumerHealthCheck();
        this.stopKafkaJsRestartWatchdog();
      }
      throw error;
    } finally {
      if (!this.isCurrentConsumer(consumer, generation)) await this.disconnectConsumer(consumer);
    }
  }

  private attachConsumerLifecycle(consumer: Consumer, generation: number): boolean {
    const events = (consumer as Consumer & { events?: Record<string, string> }).events;
    if (!events || typeof consumer.on !== 'function') return false;
    const heartbeatEvent = events.HEARTBEAT;
    if (heartbeatEvent) {
      consumer.on(heartbeatEvent, () => {
        if (this.isCurrentConsumer(consumer, generation)) {
          this.consumerLastHeartbeatAt = Date.now();
          this.consumerKafkaJsRestartGeneration = null;
          this.stopKafkaJsRestartWatchdog();
        }
      });
    }
    consumer.on(events.CRASH, (event: { payload?: { restart?: unknown } }) => {
      if (!this.isCurrentConsumer(consumer, generation)) return;
      if (event.payload?.restart === true) {
        this.cancelConsumerRecovery();
        this.consumerKafkaJsRestartGeneration = generation;
        this.logger?.warn('Kafka consumer crashed; KafkaJS scheduled its own restart');
        this.emitConsumerLifecycle('$transporter.consumer.kafkaJsRestart.started', 'crash', generation, { ownership: 'kafkajs' });
        this.startKafkaJsRestartWatchdog(consumer, generation);
        return;
      }
      this.consumerKafkaJsRestartGeneration = null;
      this.stopKafkaJsRestartWatchdog();
      void this.scheduleConsumerRecovery('crash', generation);
    });
    consumer.on(events.DISCONNECT, () => {
      if (!this.isCurrentConsumer(consumer, generation)) return;
      if (this.consumerKafkaJsRestartGeneration === generation) return;
      this.stopKafkaJsRestartWatchdog();
      void this.scheduleConsumerRecovery('disconnect', generation);
    });
    return Boolean(heartbeatEvent);
  }

  private startConsumerHealthCheck(generation: number, groupId: string, consumer: Consumer): void {
    this.stopConsumerHealthCheck();
    const interval = Number(this.options.consumer.healthCheckInterval) || 30000;
    const heartbeatTimeout = Number(this.options.consumer.heartbeatTimeout) || 120000;
    this.consumerHealthTimer = setInterval(() => {
      if (
        this.consumerStopping ||
        !this.isCurrentConsumer(consumer, generation) ||
        this.consumerKafkaJsRestartGeneration === generation ||
        Date.now() - this.consumerLastHeartbeatAt <= heartbeatTimeout
      ) {
        return;
      }

      this.logger?.warn('Kafka consumer heartbeat stalled; scheduling recovery', {
        generation,
        groupId,
        instanceID: this.star?.instanceID,
        heartbeatTimeout,
        lastHeartbeatAge: Date.now() - this.consumerLastHeartbeatAt
      });
      void this.scheduleConsumerRecovery('heartbeat_stalled', generation);
    }, interval);
    this.consumerHealthTimer.unref();
  }

  private stopConsumerHealthCheck(): void {
    if (this.consumerHealthTimer) {
      clearInterval(this.consumerHealthTimer);
      this.consumerHealthTimer = null;
    }
  }

  private startKafkaJsRestartWatchdog(consumer: Consumer, generation: number): void {
    this.stopKafkaJsRestartWatchdog();
    const delay = Number(this.options.consumer.kafkaJsRestartTimeout) || 30000;
    this.consumerKafkaJsRestartTimer = setTimeout(() => {
      this.consumerKafkaJsRestartTimer = null;
      if (!this.isCurrentConsumer(consumer, generation) || this.consumerKafkaJsRestartGeneration !== generation) return;
      this.consumerKafkaJsRestartGeneration = null;
      this.emitConsumerLifecycle('$transporter.consumer.kafkaJsRestart.timedOut', 'kafka_js_restart_timeout', generation, {
        delay,
        ownership: 'manual'
      });
      void this.scheduleConsumerRecovery('kafka_js_restart_timeout', generation);
    }, delay);
    this.consumerKafkaJsRestartTimer.unref();
  }

  private stopKafkaJsRestartWatchdog(): void {
    if (this.consumerKafkaJsRestartTimer) {
      clearTimeout(this.consumerKafkaJsRestartTimer);
      this.consumerKafkaJsRestartTimer = null;
    }
  }

  private scheduleConsumerRecovery(reason: string, generation: number): Promise<void> {
    if (!this.isCurrentGeneration(generation)) return Promise.resolve();
    if (this.consumerRecoveryPromise) return this.consumerRecoveryPromise;
    this.consumerRecoveryAttempts += 1;
    const recoveryId = `${generation}-${++this.consumerRecoveryId}`;
    const baseDelay = Number(this.options.consumer.recoveryBaseDelay) || 1000;
    const maxDelay = Number(this.options.consumer.recoveryMaxDelay) || 30000;
    const delay = Math.min(maxDelay, baseDelay * 2 ** (this.consumerRecoveryAttempts - 1));
    this.logger?.warn('Kafka consumer recovery scheduled', { reason, attempt: this.consumerRecoveryAttempts, delay });
    this.emitConsumerLifecycle('$transporter.consumer.recovery.scheduled', reason, generation, {
      attempt: this.consumerRecoveryAttempts,
      recoveryId,
      delay,
      ownership: 'manual'
    });
    let shouldRetry = false;
    const attempt = this.consumerRecoveryAttempts;
    this.consumerRecoveryPromise = new Promise<boolean>((resolve) => {
      this.resolveConsumerRecoveryDelay = resolve;
      this.consumerRecoveryTimer = setTimeout(() => {
        this.consumerRecoveryTimer = null;
        this.resolveConsumerRecoveryDelay = null;
        resolve(true);
      }, delay);
      this.consumerRecoveryTimer.unref();
    })
      .then((shouldRecover) => {
        if (!shouldRecover || !this.isCurrentGeneration(generation)) return;
        this.emitConsumerLifecycle('$transporter.consumer.recovery.started', reason, generation, {
          attempt,
          recoveryId,
          ownership: 'manual'
        });
        return this.recoverConsumer(generation).then(
          () => {
            this.emitConsumerLifecycle('$transporter.consumer.recovery.succeeded', reason, generation, {
              attempt,
              recoveryId,
              consumerGeneration: this.consumerRecoveryGeneration,
              ownership: 'manual'
            });
          },
          (error: unknown) => {
            shouldRetry = this.isCurrentGeneration(this.consumerRecoveryGeneration);
            this.logger?.warn('Kafka consumer recovery failed', { reason, attempt: this.consumerRecoveryAttempts, error: this.errorSummary(error) });
            this.emitConsumerLifecycle('$transporter.consumer.recovery.failed', reason, generation, {
              attempt: this.consumerRecoveryAttempts,
              recoveryId,
              consumerGeneration: this.consumerRecoveryGeneration,
              ownership: 'manual',
              error: this.errorSummary(error)
            });
          }
        );
      })
      .finally(() => {
        this.consumerRecoveryPromise = null;
        this.resolveConsumerRecoveryDelay = null;
        if (shouldRetry) void this.scheduleConsumerRecovery(reason, this.consumerRecoveryGeneration);
      });
    return this.consumerRecoveryPromise;
  }

  private async recoverConsumer(generation: number): Promise<void> {
    if (!this.isCurrentGeneration(generation)) return;
    const previousConsumer = this.consumer;
    this.consumer = null;
    this.consumerRecoveryGeneration += 1;
    const recoveryGeneration = this.consumerRecoveryGeneration;
    this.stopConsumerHealthCheck();
    this.consumerKafkaJsRestartGeneration = null;
    this.stopKafkaJsRestartWatchdog();
    if (previousConsumer) {
      await this.disconnectConsumer(previousConsumer);
      if (!this.isCurrentGeneration(recoveryGeneration)) return;
    }
    await this.createConsumer(this.subscribedTopics, true);
    if (!this.isCurrentGeneration(this.consumerRecoveryGeneration) || !this.consumer) {
      throw new Error('Kafka consumer recovery lost ownership during setup');
    }
    this.logger?.info('Kafka consumer recovery completed');
  }

  private cancelConsumerRecovery(): void {
    if (this.consumerRecoveryTimer) {
      clearTimeout(this.consumerRecoveryTimer);
      this.consumerRecoveryTimer = null;
    }
    if (this.resolveConsumerRecoveryDelay) {
      const resolve = this.resolveConsumerRecoveryDelay;
      this.resolveConsumerRecoveryDelay = null;
      resolve(false);
    }
  }

  /**
   * 发送动作
   */
  public async send(topic: string, data: Buffer, { packet }): Promise<void> {
    void topic;
    if (!this.producer) return Promise.resolve();

    try {
      // this.logger?.info(`[Kafka Debug] Sending ${packet.type} to ${topic}`, {
      //   key: packet.target || packet.requestID || 'default',
      //   packetTarget: packet.target
      // });
      await this.producer.send({
        topic: this.getTopicName(packet.type, packet.target),
        messages: [
          {
            // partition: this.options.publish.partition, // 移除强制分区
            key: packet.target || packet.requestID || 'default', // 使用Key进行路由
            value: data
          }
        ]
      });
    } catch (error: any) {
      this.logger?.error('Kafka Server Publish error', error);

      // 广播错误
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });

      throw error;
    }
  }
}
