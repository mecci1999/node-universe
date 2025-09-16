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
      brokers: options.host ? [options.host] : (kafkaOptions.brokers || ['localhost:9092']),
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
      producer: {
        maxInFlightRequests: 1,
        idempotent: false,
        transactionTimeout: 30000
      },
      consumer: {
        groupId: 'node-universe-group',
        sessionTimeout: 30000,
        heartbeatInterval: 3000
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
    try {
      if (this.producer) {
        await this.producer.disconnect();
        this.producer = null;
      }

      if (this.consumer) {
        await this.consumer.disconnect();
        this.consumer = null;
      }

      if (this.admin) {
        await this.admin.disconnect();
        this.admin = null;
      }

      this.client = null;
    } catch (error: any) {
      this.logger?.error('Kafka disconnect error', error.message);
    }
  }

  /**
   * 订阅动作
   */
  public async makeSubscriptions(topics: GenericObject[]): Promise<void> {
    const topicsMap = topics.map(({ cmd, nodeID }) => this.getTopicName(cmd, nodeID));

    try {
      // 使用管理员客户端创建topics
      if (this.admin) {
        await this.admin.createTopics({
          topics: topicsMap.map(topic => ({
            topic,
            numPartitions: 1,
            replicationFactor: 1
          }))
        });
      }

      // 创建消费者实例
      if (this.client) {
        const consumerOptions = Object.assign(
          {
            groupId: this.star?.instanceID || 'node-universe-group'
          },
          this.options.consumer
        );

        this.consumer = this.client.consumer(consumerOptions);

        // 连接消费者
        await this.consumer.connect();

        // 订阅topics
        for (const topic of topicsMap) {
          await this.consumer.subscribe({ topic, fromBeginning: false });
        }

        // 开始消费消息
        await this.consumer.run({
          eachMessage: async ({ topic, partition, message }) => {
            try {
              const cmd = topic.split('.')[1] as PacketTypes;
              if (message.value) {
                this.receive(cmd, message.value as Buffer);
              }
            } catch (error: any) {
              this.logger?.error('Error processing message', error);
            }
          }
        });

        this.logger?.info(`KAFKA Consumer connected and subscribed to topics: ${topicsMap.join(', ')}`);
      }
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

  /**
   * 发送动作
   */
  public async send(topic: string, data: Buffer, { packet }): Promise<void> {
    if (!this.producer) return Promise.resolve();

    try {
      await this.producer.send({
        topic: this.getTopicName(packet.type, packet.target),
        messages: [
          {
            partition: this.options.publish.partition,
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
