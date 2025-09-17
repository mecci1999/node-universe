import Packet from '../packets';
import { Stream, Transform } from 'stream';
import Star from '../star';
import { LoggerInstance } from '@/typings/logger';
import { GenericObject } from '@/typings';
import { ProtocolVersionMismatchError, Regenerator, StarServerError } from '../error';
import { StarTransitOptions, TransitRequest } from '@/typings/transit';
import { Transporter } from '@/typings/transit/transporters';
import { UniverseErrorCode, UniverseErrorOptionsType } from '@/typings/error';
import { PacketTypes } from '@/typings/packets';
import { Discoverer } from '@/typings/registry/discoverers';
import { Registry } from '../registry';
import Node from '../registry/node';
import C from '../star/constants';
import Context from '../context';
import { QueueIsFullError, RequestRejectedError, ServiceNotAvailableError, UniverseError } from '../error/custom';
import _ from 'lodash';
import { METRIC, MetricRegistry } from '../metrics';
import { sleep } from '@/utils';

export default class Transit {
  public star: Star;
  public logger: LoggerInstance; // 日志模块
  public nodeID: string; // 节点ID
  public instanceID: string;
  public transporter: Transporter; // 通信模块
  public options: StarTransitOptions | undefined;
  public discoverer: Discoverer | null; // 服务发现模块
  public metrics: MetricRegistry | null; // 性能指标模块
  public errorRegenerator: Regenerator | null;
  public pendingRequests: Map<any, TransitRequest>;
  public pendingReqStreams: Map<any, any>;
  public pendingResStreams: Map<any, any>;
  private maxPendingRequests: number;
  private maxStreamPoolSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  public connected: boolean;
  public disconnecting: boolean;
  public isReady: boolean;
  public stat: GenericObject;
  public subscribing: Promise<any> | null = null;
  public __connectResolve: any;

  constructor(star: Star, transporter: Transporter, options?: StarTransitOptions) {
    this.star = star;
    this.logger = star.getLogger('transit');
    this.nodeID = star.nodeID || '';
    this.metrics = star.metrics; // 性能指标
    this.instanceID = star.instanceID;
    this.transporter = transporter;
    this.options = _.defaultsDeep(
      {
        maxQueueSize: 50000 // 请求最大数量为50000
      },
      options
    );
    this.discoverer = (star.registry as Registry).discoverer;
    this.errorRegenerator = star.errorRegenerator;

    this.pendingRequests = new Map();
    this.pendingReqStreams = new Map();
    this.pendingResStreams = new Map();
    this.maxPendingRequests = options?.maxQueueSize || 10000;
    this.maxStreamPoolSize = 1000;
    
    // 启动定期清理机制
    this.startCleanupTimer();

    /* deprecated */
    this.stat = {
      packets: {
        sent: {
          count: 0,
          bytes: 0
        },
        received: {
          count: 0,
          bytes: 0
        }
      }
    };

    this.connected = false;
    this.disconnecting = false;
    this.isReady = false;

    const wrappedMessageHandler = (cmd: string, packet: any) => this.messageHandler(cmd, packet);

    this.publish = this.star.wrapMethod('transitPublish', this.publish, this) as any;
    this.messageHandler = this.star.wrapMethod('transitMessageHandler', this.messageHandler, this) as any;

    if (this.transporter) {
      // 初始化
      this.transporter.init(this, wrappedMessageHandler, this.afterConnect.bind(this));
    }

    this.__connectResolve = null;

    this.registerUniverseMetrics();
  }

  /**
   * 注册通信相关指标
   */
  private registerUniverseMetrics() {
    if (!this.star.isMetricsEnabled()) return;

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_TRANSIT_READY,
        type: METRIC.TYPE_GAUGE,
        description: '通信模块已准备'
      })
      ?.set(0);

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_TRANSIT_CONNECTED,
        type: METRIC.TYPE_GAUGE,
        description: '通信模块已连接'
      })
      ?.set(0);

    this.metrics?.register({
      name: METRIC.UNIVERSE_TRANSIT_PONG_TIME,
      type: METRIC.TYPE_GAUGE,
      labelNames: ['targetNodeID'],
      description: 'ping操作时间'
    });

    this.metrics?.register({
      name: METRIC.UNIVERSE_TRANSIT_PONG_SYSTIME_DIFF,
      type: METRIC.TYPE_GAUGE,
      labelNames: ['targetNodeID'],
      description: '不同节点间的系统时间'
    });

    this.metrics?.register({
      name: METRIC.UNIVERSE_TRANSIT_ORPHAN_RESPONSE_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '响应回复次数'
    });
  }

  /**
   * tranporter模块连接成功之后
   */
  public async afterConnect(wasReconnect: boolean) {
    try {
      if (wasReconnect) {
        await this.discoverer?.sendLocalNodeInfo();
      } else {
        await this.makeSubscriptions();
      }
      // 注册发现其他的节点
      await this.discoverer?.discoverAllNodes();
      // 等待500ms时间，接收数据包
      await sleep(500);

      this.connected = true;
      // 性能注册
      this.metrics?.set(METRIC.UNIVERSE_TRANSIT_CONNECTED, 1);
      // 广播
      this.star.broadcastLocal('$transporter.connected', {
        wasReconnect: !!wasReconnect
      });

      if (this.__connectResolve) {
        this.isReady = true;
        this.__connectResolve();
        this.__connectResolve = null;
      }

      return null;

      // return Promise.resolve()
      //   .then(() => {
      //     if (wasReconnect) {
      //       // 重新连接后，更新该节点的信息
      //       return this.discoverer?.sendLocalNodeInfo();
      //     } else {
      //       // 首次连接，完成订阅动作
      //       return this.makeSubscriptions();
      //     }
      //   })
      //   .then(() => this.discoverer?.discoverAllNodes())
      //   .then(() => {
      //     return new Promise((resolve) => {
      //       setTimeout(resolve, 500);
      //     });
      //   })
      //   .then(() => {
      //     // 等待500ms时间，接收数据包
      //     this.connected = true;
      //     // 性能注册
      //     this.metrics?.set(METRIC.UNIVERSE_TRANSIT_CONNECTED, 1);
      //     // 广播
      //     this.star.broadcastLocal('$transporter.connected', {
      //       wasReconnect: !!wasReconnect
      //     });

      //     if (this.__connectResolve) {
      //       this.isReady = true;
      //       this.__connectResolve();
      //       this.__connectResolve = null;
      //     }

      //     return null;
      //   });
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * 连接到tansporter模块，如果失败，每次间隔5s后会重试
   */
  public connect() {
    this.logger.info('Connecting to the transporter...');

    return new Promise((resolve) => {
      this.__connectResolve = resolve;

      const doConnect = () => {
        let reconnectStarted = false;

        /* istanbul ignore next */
        const errorHandler = (error) => {
          if (this.disconnecting) return;
          if (reconnectStarted) return;

          this.logger.warn('Connection is failed.', (error && error.message) || 'Unknown error');
          this.logger.debug(error);

          if (this.options?.disableReconnect) {
            // 禁止重新连接
            return;
          }

          reconnectStarted = true;

          setTimeout(() => {
            this.logger.info('Reconnecting...');
            doConnect();
          }, 5 * 1000);
        };

        // 连接transporter模块
        /* istanbul ignore next */
        this.transporter.connect().catch((error) => {
          errorHandler(error);
        });
      };

      doConnect();
    });
  }

  /**
   * 断开链接
   */
  public disconnect() {
    this.connected = false;
    this.isReady = false;
    this.disconnecting = true;
    this.metrics?.set(METRIC.UNIVERSE_TRANSIT_CONNECTED, 0);

    this.star.broadcastLocal('$transporter.disconnected', { graceFul: true });

    return Promise.resolve()
      .then(() => {
        if (this.transporter.connected) {
          return this.discoverer?.localNodeDisconnected().then(() => this.transporter.disconnect());
        }
      })
      .then(() => {
        this.stopCleanupTimer();
        this.disconnecting = false;
      });
  }

  /**
   * 本地节点准备好了，所有的服务加载完毕
   */
  public ready() {
    if (this.connected) {
      // 性能参数注册
      this.metrics?.set(METRIC.UNIVERSE_TRANSIT_READY, 1);

      return;
    }
  }

  /**
   * 发送一个断开链接的包给远程的节点
   */
  public sendDisconnectPacket() {
    return this.publish(new Packet(PacketTypes.PACKET_DISCONNECT, null, {})).catch((error) => {
      this.logger.error('Unable to send DISCONNECT packet.', error);
    });
  }

  /**
   * 订阅通信过程中所有的动作
   */
  public makeSubscriptions() {
    this.subscribing = this.transporter
      .makeSubscriptions([
        // 订阅广播事件
        { cmd: PacketTypes.PACKET_EVENT, nodeID: this.nodeID },

        // 订阅请求事件
        { cmd: PacketTypes.PACKET_REQUEST, nodeID: this.nodeID },

        // 订阅节点对请求的响应事件
        { cmd: PacketTypes.PACKET_RESPONSE, nodeID: this.nodeID },

        // 订阅服务发现处理事件
        { cmd: PacketTypes.PACKET_DISCOVER },
        { cmd: PacketTypes.PACKET_DISCOVER, nodeID: this.nodeID },

        // 订阅节点信息处理事件
        { cmd: PacketTypes.PACKET_INFO }, // 广播信息，如果一个新的节点进行连接动作
        { cmd: PacketTypes.PACKET_INFO, nodeID: this.nodeID },

        // 订阅断开链接事件
        { cmd: PacketTypes.PACKET_DISCONNECT },

        // 订阅心跳处理事件
        { cmd: PacketTypes.PACKET_HEARTBEAT },

        // 订阅ping请求事件
        { cmd: PacketTypes.PACKET_PING },
        { cmd: PacketTypes.PACKET_PING, nodeID: this.nodeID },

        //订阅pong响应事件
        { cmd: PacketTypes.PACKET_PONG, nodeID: this.nodeID }
      ])
      .then(() => {
        this.subscribing = null;
      });

    return this.subscribing;
  }

  /**
   * 消息处理器
   */
  public messageHandler(cmd: string, msg: GenericObject) {
    try {
      const payload = msg?.payload;
      if (!payload) {
        throw new StarServerError(
          'Missing response payload.',
          UniverseErrorCode.SERVICE_ERROR,
          UniverseErrorOptionsType.MISSING_PAYLOAD
        );
      }

      // 检查协议版本号
      if (payload.version !== Star.PROTOCOL_VERSION && !this.options?.disableVersionCheck) {
        throw new ProtocolVersionMismatchError({
          nodeID: payload.sender,
          actual: Star.PROTOCOL_VERSION,
          received: payload.version
        });
      }

      if (payload.sender === this.nodeID) {
        if (cmd === PacketTypes.PACKET_INFO && payload.instanceID !== this.instanceID) {
          this.star.fatal('Star has detected a nodeID conflict, use unique nodeIDs. Star Stopped.');

          return Promise.resolve(false);
        }

        if (
          cmd !== PacketTypes.PACKET_EVENT &&
          cmd !== PacketTypes.PACKET_REQUEST &&
          cmd !== PacketTypes.PACKET_RESPONSE
        ) {
          return Promise.resolve(false);
        }
      }

      // Request
      if (cmd === PacketTypes.PACKET_REQUEST) {
        return this.requestHandler(payload).then(() => true);
      }

      // Response
      else if (cmd === PacketTypes.PACKET_RESPONSE) {
        this.responseHandler(payload);
      }

      // Event
      else if (cmd === PacketTypes.PACKET_EVENT) {
        return this.eventHandler(payload);
      }

      // Discover
      else if (cmd === PacketTypes.PACKET_DISCOVER) {
        this.discoverer?.sendLocalNodeInfo(payload.sender || this.nodeID);
      }

      // Node Info
      else if (cmd === PacketTypes.PACKET_INFO) {
        this.discoverer?.processRemoteNodeInfo(payload.sender, payload);
      }

      // Disconnect
      else if (cmd === PacketTypes.PACKET_DISCONNECT) {
        this.discoverer?.remoteNodeDisconnected(payload.sender, false);
      }

      // Heartbeat
      else if (cmd === PacketTypes.PACKET_HEARTBEAT) {
        this.discoverer?.heartbeatReceived(payload.sender, payload);
      }

      // Ping
      else if (cmd === PacketTypes.PACKET_PING) {
        this.sendPong(payload);
      }

      // Pong
      else if (cmd === PacketTypes.PACKET_PONG) {
        this.processPong(payload);
      }

      return Promise.resolve(true);
    } catch (error) {
      // 日志
      this.logger.error(error, cmd, msg);
      // 广播通知所有的节点
      this.star.broadcastLocal('$transit.error', {
        error,
        module: 'transit',
        type: C.FAILED_PROCESSING_PACKET
      });
    }
  }

  /**
   * 请求处理器
   */
  private requestHandler(payload: GenericObject): Promise<any> {
    const requestID = payload.requestID ? `with requestID ' ${payload.requestID} '` : '';
    this.logger.debug(`<= Request '${payload.action}' ${requestID} received from '${payload.sender}' node.`);

    try {
      if (this.star.stopping) {
        // 如果star状态是停止
        this.logger.warn(
          `Incoming '${payload.action}' ${requestID} request from '${payload.sender}' node is dropped because star is stopped.`
        );
        // 抛出错误
        throw new ServiceNotAvailableError({ action: payload.action, nodeID: this.nodeID });
      }

      let pass: any;
      if (payload.stream != undefined) {
        // 如果请求中存在流，调用处理请求流的方法
        pass = this._handleIncomingRequestStream(payload);
        if (pass === null) return Promise.resolve();
      }

      const endpoint = this.star._getLocalActionEndpoint(payload.action);
      // 获取到有效的节点，创建一个新的上下文
      const ctx = new this.star.ContextFactory(this.star);
      ctx.setEndpoint(endpoint);
      ctx.id = payload.id;
      ctx.setParams(pass ? pass : payload.params, this.star.options.contextParamsCloning);
      ctx.parentID = payload.parentID;
      ctx.requestID = payload.requestID;
      ctx.caller = payload.caller;
      ctx.meta = payload.meta || {};
      ctx.level = payload.level;
      ctx.tracing = payload.tracing;
      ctx.nodeID = payload.sender;

      if (payload.timeout != null) ctx.options.timeout = payload.timeout;

      if (endpoint && endpoint.action?.handler) {
        const p = endpoint.action?.handler(ctx);
        p.ctx = ctx;

        return p
          .then((res) => this.sendResponse(payload.sender, payload.id, ctx.meta, res, null))
          .catch((err) => this.sendResponse(payload.sender, payload.id, ctx.meta, null, err));
      }

      return Promise.reject(
        new UniverseError('transit module requestHandler action is error, not get effective endpoint info.')
      );
    } catch (error: any) {
      return this.sendResponse(payload.sender, payload.id, payload.meta, null, error);
    }
  }

  /**
   * 响应处理器
   */
  public responseHandler(packet: GenericObject) {
    const id = packet.id;
    const req = this.pendingRequests.get(id);

    // 如果不存在该请求，则不处理
    if (req == null) {
      this.logger.debug(
        'Orphan response is received. Maybe the request is timed out earlier. ID:',
        packet.id,
        ', Sender:',
        packet.sender
      );
      this.metrics?.increment(METRIC.UNIVERSE_TRANSIT_ORPHAN_RESPONSE_TOTAL);

      return;
    }

    this.logger.debug(`<= Response '${req?.action.name}' is received from '${packet.sender}'.`);

    if (req?.ctx) {
      // 更新nodeID
      req.ctx.nodeID = packet.sender;
      // 合并meta
      Object.assign(req.ctx.meta || {}, packet.meta || {});
    }

    // 处理响应式流
    if (packet.stream != null) {
      if (this._handleIncomingResponseStream(packet, req as TransitRequest)) return;
    }

    // 移除等待的请求
    this.removePendingRequest(id);

    if (!packet.success) {
      // 失败
      req?.reject(this._createErrorFromPayload(packet.error, packet));
    } else {
      req?.resolve(packet.data);
    }
  }

  /**
   * 向节点发送ping请求，不传nodeID则向所有的node节点发送ping请求
   */
  public sendPing(nodeID?: string, id?: string) {
    const packet = new Packet(PacketTypes.PACKET_PING, nodeID, {
      time: Date.now(),
      id: id || this.star.generateUid()
    });

    return this.publish(packet);
  }

  /**
   * 发送pong响应结果
   */
  public sendPong(payload: GenericObject) {
    const packet = new Packet(PacketTypes.PACKET_PONG, payload.sender, {
      time: payload.time,
      id: payload.id,
      arrived: Date.now()
    });

    return this.publish(packet).catch((error) => {
      this.logger.error(`Unable to send PONG packet to '${payload.sender}' node.`, error);

      // 广播错误
      this.star.broadcastLocal('$transit.error', { error: error, module: 'transit', type: C.FAILED_SEND_PING_PACKET });
    });
  }

  /**
   * 处理Pong包
   */
  public processPong(payload: GenericObject) {
    const now = Date.now();
    const elapsedTime = now - payload.time;
    // 时间间隔
    const timeDiff = Math.round(now - payload.arrived - elapsedTime / 2);

    this.logger.debug(`PING-PONG from '${payload.sender}' - Time: ${elapsedTime}ms, Time difference: ${timeDiff}ms`);

    this.star.broadcastLocal('$node.pong', {
      nodeID: payload.sender,
      elapsedTime,
      timeDiff,
      id: payload.id
    });

    this.metrics?.set(METRIC.UNIVERSE_TRANSIT_PONG_TIME, elapsedTime, { targetNodeID: payload.sender });
    this.metrics?.set(METRIC.UNIVERSE_TRANSIT_PONG_SYSTIME_DIFF, timeDiff, { targetNodeID: payload.sender });
  }

  /**
   * 发送响应结果
   */
  public sendResponse(nodeID: string, id: string, meta: any, data: any, error: Error | null) {
    const payload = {
      id: id,
      meta: meta,
      success: error == null,
      data: data
    } as GenericObject;

    if (error) payload.error = this._createErrorFromPayload(error, payload);

    // 发送报错处理方法
    const publishCatch = (error) => {
      this.logger.error(`Unable to send '${id}' response to '${nodeID}' node.`, error);
      // 广播
      this.star.broadcastLocal('$transit.error', {
        error: error,
        module: 'transit',
        type: C.FAILED_SEND_RESPONSE_PACKET
      });
    };

    if (data && data?.readable === true && typeof data.on === 'function' && typeof data.pipe === 'function') {
      // 流数据处理响应
      payload.stream = true;
      if (data.readableObjectMode === true || (data._readableState && data._readableState.objectMode === true)) {
        payload.meta = payload.meta || {};
        payload.meta['$streamObjectMode'] = true;
      }
      payload.seq = 0;

      const stream = data;
      stream.pause();

      // 流数据处理
      stream.on('data', (chunk) => {
        stream.pause();
        const chunks: Buffer[] = [];
        if (
          chunk instanceof Buffer &&
          this.options?.maxChunkSize &&
          this.options?.maxChunkSize > 0 &&
          chunk.length > this.options.maxChunkSize
        ) {
          let len = chunk.length;
          let i = 0;
          // 根据配置的最大允许量，切片通信
          while (i < len) {
            chunks.push(chunk.slice(i, (i += this.options.maxChunkSize)));
          }
        } else {
          chunks.push(chunk);
        }

        for (const ch of chunks) {
          const copy = Object.assign({}, payload);
          copy.seq = ++payload.seq;
          copy.stream = true;
          copy.data = ch;

          this.logger.debug(`=> Send stream chunk to ${nodeID} node. Seq: ${copy.seq}`);
          this.publish(new Packet(PacketTypes.PACKET_RESPONSE, nodeID, copy)).catch(publishCatch);
        }

        stream.resume();

        return;
      });

      // 处理流结束
      stream.on('end', () => {
        const copy = Object.assign({}, payload);
        copy.stream = false;
        copy.seq = ++payload.seq;
        copy.data = null;

        this.logger.debug(`=> Send stream closing to ${nodeID} node. Seq: ${copy.seq}`);

        return this.publish(new Packet(PacketTypes.PACKET_RESPONSE, nodeID, copy)).catch(publishCatch);
      });

      // 处理流报错
      stream.on('error', (error) => {
        const copy = Object.assign({}, payload);
        copy.stream = false;
        copy.seq = ++payload.seq;

        if (error) {
          copy.success = false;
          copy.error = this._createErrorFromPayload(error, payload);
        }

        this.logger.debug(`=> Send stream error to ${nodeID} node.`, copy.error);

        return this.publish(new Packet(PacketTypes.PACKET_RESPONSE, nodeID, copy)).catch(publishCatch);
      });

      payload.data = null;

      return this.publish(new Packet(PacketTypes.PACKET_RESPONSE, nodeID, payload))
        .then(() => {
          if (payload.stream) stream.resume();
        })
        .catch(publishCatch);
    }

    return this.publish(new Packet(PacketTypes.PACKET_RESPONSE, nodeID, payload)).catch(publishCatch);
  }

  /**
   * 事件处理器
   */
  public eventHandler(payload: GenericObject) {
    this.logger.debug(
      `Event '${payload.event}' received from '${payload.sender}' node` +
      (payload.groups ? ` in '${payload.groups.join(', ')}' group(s)` : '' + '.')
    );

    if (this.star.stopping) {
      this.logger.warn(
        `Incoming '${payload.event}' event from '${payload.sender}' node is dropped, because star is stopped.`
      );

      return Promise.resolve(false);
    }

    // 创建一个上下文，发送给对应的节点进行处理
    const ctx = new this.star.ContextFactory(this.star);

    ctx.id = payload.id;
    ctx.eventName = payload.event;
    ctx.setParams(payload.data, this.star.options.contextParamsCloning);
    ctx.eventGroups = payload.groups;
    ctx.eventType = payload.broadcast ? 'broadcast' : 'emit';
    ctx.meta = payload.meta || {};
    ctx.level = payload.level;
    ctx.tracing = !!payload.tracing;
    ctx.parentID = payload.parentID;
    ctx.requestID = payload.requestID;
    ctx.caller = payload.caller;
    ctx.nodeID = payload.sender;

    return this.star.emitLocalServices(ctx).then(() => true);
  }

  /**
   * 订阅动作
   */
  public subscribe(topic: string, nodeID: string) {
    return this.transporter.subscribe(topic, nodeID);
  }

  /**
   * 发布动作
   */
  public publish(packet: Packet) {
    if (this.subscribing) {
      // 订阅所有的通信动作
      return this.subscribing.then(() => {
        return this.transporter.prepublish(packet);
      });
    }

    return this.transporter.prepublish(packet);
  }

  /**
   * 发送一个节点的心跳
   */
  public sendHeartbeat(localNode: Node) {
    const packet = new Packet(PacketTypes.PACKET_HEARTBEAT, null, { cpu: localNode.cpu });
    if (!packet) return Promise.reject();

    return this.publish(packet).catch((error) => {
      this.handleTransitError(error, {
         operation: 'send',
         target: localNode.id,
         errorType: C.FAILED_SEND_HEARTBEAT_PACKET
       });
    });
  }

  /**
   * 发送一个事件给远程的节点
   */
  public sendEvent(ctx: Context) {
    const groups = ctx.eventGroups;
    const requestID = ctx.requestID ? "with requestID '" + ctx.requestID + "' " : '';
    if (ctx.endpoint) {
      this.logger.debug(
        `=> Send '${ctx.eventName}' event ${requestID}to ${ctx.nodeID}' node` +
        (groups ? ` in '${groups.join(', ')}' group(s)` : '') +
        '.'
      );
    } else {
      this.logger.debug(`=> Send '${ctx.eventName}' event ${requestID}to '${groups?.join(', ')}' group(s).`);
    }

    const packet = new Packet(PacketTypes.PACKET_EVENT, ctx.endpoint ? ctx.nodeID : null, {
      id: ctx.id,
      event: ctx.eventName,
      data: ctx.params,
      groups,
      broadcast: ctx.eventType == 'broadcast',
      meta: ctx.meta,
      level: ctx.level,
      tracing: ctx.tracing,
      parentID: ctx.parentID,
      requestID: ctx.requestID,
      caller: ctx.caller,
      needAck: ctx.needAck
    });

    return this.publish(packet).catch((error) => {
      this.handleTransitError(error, {
         operation: 'send',
         target: ctx.nodeID || 'groups',
         requestID: ctx.requestID ? ctx.requestID : undefined,
         eventName: ctx.eventName || 'unknowEvent',
         errorType: C.FAILED_SEND_EVENT_PACKET
       });
    });
  }

  /**
   * 根据nodeID移除一个正在审核的请求或流
   * @param nodeID
   */
  public removePendingRequestByNodeID(nodeID: string) {
    this.logger.debug(`Remove pending requests of '${nodeID}' node.`);
    this.pendingRequests.forEach((req, id) => {
      if (req.nodeID === nodeID) {
        this.pendingRequests.delete(id);
        this.pendingReqStreams.delete(id);
        this.pendingResStreams.delete(id);
        req.reject(new RequestRejectedError({ action: req.action?.name || req.action, nodeID: req.nodeID }));
      }
    });
  }

  /**
   * 发送一个请求给一个远程的服务
   */
  public request(ctx: Context) {
    if (this.options?.maxQueueSize && this.pendingRequests.size >= this.options.maxQueueSize) {
      // 待发送的请求数量超出设置的最大数量
      return Promise.reject(
        new QueueIsFullError({
          action: ctx?.action?.name || '',
          nodeID: this.nodeID,
          size: this.pendingRequests.size,
          limit: this.options.maxQueueSize
        })
      );
    }

    return new Promise((resolve, reject) => this._sendRequest(ctx, resolve, reject));
  }

  /**
   * 发送一个远程请求
   */
  public _sendRequest(ctx: Context, resolve: any, reject: any) {
    // 是否为流
    const isStream =
      ctx.params &&
      ctx.params.readable === true &&
      typeof ctx.params.on === 'function' &&
      typeof ctx.params.pipe === 'function';

    const request: TransitRequest & { timestamp: number } = {
      action: ctx.action,
      nodeID: ctx.nodeID || '',
      ctx,
      resolve,
      reject,
      stream: isStream,
      timestamp: Date.now()
    };

    const payload: any = {
      id: ctx.id,
      action: ctx.action?.name || '',
      params: isStream ? null : ctx.params,
      meta: ctx.meta,
      timeout: ctx.options.timeout,
      level: ctx.level,
      tracing: ctx.tracing,
      parentID: ctx.parentID,
      requestID: ctx.requestID,
      caller: ctx.caller,
      stream: isStream
    };

    if (payload.stream) {
      // 使用流
      if (
        ctx.params.readableObjectMode === true ||
        (ctx.params._readableState && ctx.params._readableState.objectMode === true)
      ) {
        payload.meta = payload.meta || {};
        payload.meta['$streamObjectMode'] = true;
      }
      payload.seq = 0;
    }

    const packet = new Packet(PacketTypes.PACKET_REQUEST, ctx.nodeID, payload);
    const nodeName = ctx.nodeID ? `'${ctx.nodeID}'` : 'someone';
    const requestID = ctx.requestID ? "with requestID '" + ctx.requestID + "' " : '';
    this.logger.debug(`=> Send '${ctx.action?.name}' request ${requestID} to ${nodeName} node.`);

    const publishCatch = (error) => {
      this.handleTransitError(error, {
         operation: 'send',
         target: ctx.nodeID || undefined,
         requestID: ctx.requestID || undefined,
         action: ctx.action?.name,
         errorType: C.FAILED_SEND_REQUEST_PACKET
       });
    };

    // 添加到审核队列中
    this.pendingRequests.set(ctx.id, request);

    // 发布请求
    return this.publish(packet)
      .then(() => {
        if (isStream) {
          // 使用流发送请求
          payload.meta = {};
          if (
            ctx.params.readableObjectMode === true ||
            (ctx.params._readableState && ctx.params._readableState.objectMode === true)
          ) {
            payload.meta['$streamObjectMode'] = true;
          }

          const stream = ctx.params; // 可读流
          stream.on('data', (chunk) => {
            // 暂停流
            stream.pause();
            const chunks: Buffer[] = [];
            if (
              chunk instanceof Buffer &&
              this.options?.maxChunkSize &&
              this.options?.maxChunkSize > 0 &&
              chunk.length > this.options.maxChunkSize
            ) {
              // 请求流的长度超出了最大的大小限制
              let len = chunk.length;
              let i = 0;
              while (i < len) {
                chunks.push(chunk.slice(i, (i += this.options.maxChunkSize)));
              }
            } else {
              chunks.push(chunk);
            }
            for (const ch of chunks) {
              const copy = Object.assign({}, payload);
              copy.seq = ++payload.seq;
              copy.stream = true;
              copy.params = ch;

              this.logger.debug(`=> Send steam chunk ${requestID} to ${nodeName} node. Seq: ${copy.seq}`);
              this.publish(new Packet(PacketTypes.PACKET_REQUEST, ctx.nodeID, copy)).catch(publishCatch);
            }
            // 继续
            stream.resume();
            return;
          });

          stream.on('end', () => {
            const copy = Object.assign({}, payload);
            copy.seq = ++payload.seq;
            copy.params = null;
            copy.stream = false;

            this.logger.debug(`=> Send stream closing ${requestID} to ${nodeName} node. Seq: ${copy.seq}`);

            return this.publish(new Packet(PacketTypes.PACKET_REQUEST, ctx.nodeID, copy)).catch(publishCatch);
          });

          stream.on('error', (error) => {
            const copy = Object.assign({}, payload);
            copy.seq = ++payload.seq;
            copy.params = null;
            copy.stream = false;
            copy.meta['$streamError'] = this._createPayloadErrorField(error, payload);

            this.logger.debug(`=> Send stream error ${requestID} to ${nodeName} node.`, copy.meta['$streamError']);

            return this.publish(new Packet(PacketTypes.PACKET_REQUEST, ctx.nodeID, copy)).catch(publishCatch);
          });
        }
      })
      .catch((error) => {
        publishCatch(error);
        reject(error);
      });
  }

  /**
   * 创建一个错误的字段
   */
  public _createPayloadErrorField(error: any, payload: any) {
    return this.errorRegenerator?.extracPlainError(error, payload);
  }

  /**
   * 发送节点信息
   * @param nodeID 发送的目标节点
   */
  public sendNodeInfo(info: any, nodeID: string) {
    if (!this.connected || !this.isReady) return Promise.resolve();

    return this.publish(
      new Packet(PacketTypes.PACKET_INFO, nodeID, {
        services: info.services,
        ipList: info.ipList,
        hostname: info.hostname,
        client: info.client,
        config: info.config,
        instanceID: this.star.instanceID,
        metadata: info.metadata,
        seq: info.seq
      })
    ).catch((error) => {
      this.logger.error(`Unable to send INFO packet to '${nodeID}' node.`, error);
      this.star.broadcastLocal('$transit.error', {
        error,
        module: 'transit',
        type: C.FAILED_SEND_INFO_PACKET
      });
    });
  }

  /**
   * 处理请求中的流
   */
  private _handleIncomingRequestStream(payload: GenericObject): Stream | boolean | null {
    // 先查看请求流中是否存在
    let pass = this.pendingReqStreams.get(payload.id);
    let isNew = false;

    if (!payload.stream && !pass && !payload.seq) {
      // 不是流数据
      return false;
    }

    if (!pass) {
      // 不存在
      isNew = true;
      this.logger.info(`<= New stream is received from '${payload.sender}'. Seq: ${payload?.seq}`);

      // 创建一个新的流
      pass = new Transform({
        objectMode: payload.meta && payload.meta['$streamObjectMode'],
        transform: function (chunk: any, encoding: BufferEncoding, done) {
          this.push(chunk);

          return done();
        }
      });

      pass.$prevSeq = -1;
      pass.$pool = new Map();
      pass.$poolTimeout = new Map();
      pass.$createdAt = Date.now();

      this.pendingReqStreams.set(payload.id, pass);
    }

    if (payload.seq > pass.$prevSeq + 1) {
      // 检查池大小限制
      if (pass.$pool.size >= this.maxStreamPoolSize) {
        this.logger.warn(`Stream pool size limit reached (${this.maxStreamPoolSize}), dropping packet. Seq: ${payload.seq}`);
        return null;
      }
      
      this.logger.debug(`Put the chunk into pool (size: ${pass.$pool.size}). Seq: ${payload.seq}`);
      
      pass.$pool.set(payload.seq, payload);
      
      // 设置超时清理
      const timeoutId = setTimeout(() => {
        if (pass.$pool.has(payload.seq)) {
          this.logger.warn(`Removing expired packet from pool. Seq: ${payload.seq}`);
          pass.$pool.delete(payload.seq);
          pass.$poolTimeout.delete(payload.seq);
        }
      }, 30000); // 30秒超时
      
      pass.$poolTimeout.set(payload.seq, timeoutId);
      
      return null;
    }

    pass.$prevSeq = payload.seq;

    if (pass.$prevSeq > 0) {
      if (!payload.stream) {
        // 检查流错误
        if (payload.meta && payload.meta['$streamError']) {
          pass.emit('error', this._createErrorFromPayload(payload.meta['$streamError'], payload));
        }

        this.logger.debug(`<= Stream closing is received from '${payload.sender}'. Seq: ${payload.seq}`);

        // 结束
        pass.end();

        // 从请求队列中清除
        this.pendingReqStreams.delete(payload.id);

        return null;
      } else {
        this.logger.debug(`<= Stream chunk is received from '${payload.sender}'. Seq: ${payload.seq}`);

        pass.write(payload.params.type === 'Buffer' ? Buffer.from(payload.params.data) : payload.params);
      }
    }

    // 检查池子中是否还有流
    if (pass.$pool.size > 0) {
      this.logger.debug(`Has stored packets. Size: ${pass.$pool.size}`);
      const nextSeq = pass.$prevSeq + 1;
      const nextPacket = pass.$pool.get(nextSeq);
      if (nextPacket) {
        pass.$pool.delete(nextSeq);
        // 清理对应的超时定时器
        const timeoutId = pass.$poolTimeout.get(nextSeq);
        if (timeoutId) {
          clearTimeout(timeoutId);
          pass.$poolTimeout.delete(nextSeq);
        }
        setImmediate(() => this.requestHandler(nextPacket));
      }
    }

    return pass && payload.seq === 0 ? pass : null;
  }

  /**
   * 处理接收的响应中的流
   */
  private _handleIncomingResponseStream(packet: GenericObject, req: TransitRequest) {
    let pass = this.pendingReqStreams.get(packet.id);

    if (!pass) {
      this.logger.debug(`<= New stream is received from '${packet.sender}'. Seq: ${packet.seq}`);

      // 创建一个新的流
      pass = new Transform({
        objectMode: packet.meta && packet.meta['$streamObjectMode'],
        transform: function (chunk, encoding, done) {
          this.push(chunk);
          return done();
        }
      });

      pass.$prevSeq = -1;
      pass.$pool = new Map();
      pass.$poolTimeout = new Map();
      pass.$createdAt = Date.now();

      this.pendingResStreams.set(packet.id, pass);
    }

    if (packet.seq > pass.$prevSeq + 1) {
      // 检查池大小限制
      if (pass.$pool.size >= this.maxStreamPoolSize) {
        this.logger.warn(`Response stream pool size limit reached (${this.maxStreamPoolSize}), dropping packet. Seq: ${packet.seq}`);
        return true;
      }
      
      // 有一些数据块没有发出去，需要存储这些没有数据块
      this.logger.debug(`Put the chunk into pool (size: ${pass.$pool.size}). Seq: ${packet.seq}`);

      pass.$pool.set(packet.seq, packet);
      
      // 设置超时清理
      const timeoutId = setTimeout(() => {
        if (pass.$pool.has(packet.seq)) {
          this.logger.warn(`Removing expired response packet from pool. Seq: ${packet.seq}`);
          pass.$pool.delete(packet.seq);
          pass.$poolTimeout.delete(packet.seq);
        }
      }, 30000); // 30秒超时
      
      pass.$poolTimeout.set(packet.seq, timeoutId);

      return true;
    }

    pass.$prevSeq = packet.seq;

    if (pass && packet.seq === 0) {
      req.resolve(pass);
    }

    if (pass.$prevSeq > 0) {
      if (!packet.stream) {
        // 不使用流
        if (!packet.success) {
          // 接收报错
          (pass as Transform).emit('error', this._createErrorFromPayload(packet.error, packet));
        }

        // 日志
        this.logger.debug(`<= Stream closing is received from '${packet.sender}'. Seq: ${packet.seq}`);
        // 流结束
        pass.end();
        // 删除等待的请求
        this.removePendingRequest(packet.id);

        return true;
      } else {
        this.logger.debug(`<= Stream chunk is received from '${packet.sender}'. Seq: ${packet.seq}`);

        // 转换为流
        (pass as Transform).write(packet.data.type === 'Buffer' ? Buffer.from(packet.data.data) : packet.data);
      }
    }

    // 清理池子中存储的数据块
    if (pass.$pool.size > 0) {
      this.logger.debug(`Has stored packets. Size: ${pass.$pool.size}`);
      const nextSeq = pass.$prevSeq + 1;
      const nextPacket = pass.$pool.get(nextSeq);
      if (nextPacket) {
        pass.$pool.delete(nextSeq);
        // 清理对应的超时定时器
        const timeoutId = pass.$poolTimeout.get(nextSeq);
        if (timeoutId) {
          clearTimeout(timeoutId);
          pass.$poolTimeout.delete(nextSeq);
        }
        setImmediate(() => this.responseHandler(nextPacket));
      }
    }

    return true;
  }

  /**
   * 创建一个错误的实例
   */
  private _createErrorFromPayload(error, payload) {
    return this.errorRegenerator?.restore(error, payload);
  }

  /**
   * 移除等待处理的请求
   */
  public removePendingRequest(id: any) {
    this.pendingRequests.delete(id);
    this.pendingReqStreams.delete(id);
    this.pendingResStreams.delete(id);
  }



  /**
   * 统一错误处理方法
   */
  private handleTransitError(error: Error, context: {
    operation: string;
    target?: string;
    requestID?: string;
    eventName?: string;
    action?: string;
    errorType: string;
  }) {
    const { operation, target, requestID, eventName, action, errorType } = context;
    const targetInfo = target ? ` to '${target}'` : '';
    const requestInfo = requestID ? ` with requestID '${requestID}'` : '';
    const operationInfo = eventName ? `'${eventName}' event` : action ? `'${action}' request` : operation;
    
    this.logger.error(`Unable to ${operation} ${operationInfo}${requestInfo}${targetInfo}.`, error);
    
    this.star.broadcastLocal('$transit.error', {
      error,
      module: 'transit',
      type: errorType,
      context: {
        operation,
        target,
        requestID,
        eventName,
        action
      }
    });
  }

  /**
   * 启动内存清理定时器
   */
  private startCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 停止内存清理定时器
   */
  private stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 清理过期的请求和流
   */
  private cleanupExpiredRequests() {
    const now = Date.now();
    const timeout = 300000; // 5分钟超时
    
    // 清理过期的pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      if ((req as any).timestamp && now - (req as any).timestamp > timeout) {
        this.logger.warn(`Cleaning up expired request: ${id}`);
        this.removePendingRequest(id);
        req.reject(new Error('Request timeout during cleanup'));
      }
    }
    
    // 限制Map大小
    if (this.pendingRequests.size > this.maxPendingRequests) {
      const excess = this.pendingRequests.size - this.maxPendingRequests;
      const oldestEntries = Array.from(this.pendingRequests.entries()).slice(0, excess);
      for (const [id, req] of oldestEntries) {
        this.logger.warn(`Cleaning up excess request: ${id}`);
        this.removePendingRequest(id);
        req.reject(new Error('Request removed due to memory limit'));
      }
    }
  }

  /**
   * 连接之后，发现其他的节点
   */
  public discoverNodes() {
    return this.publish(new Packet(PacketTypes.PACKET_DISCOVER, null, {})).catch((error) => {
      this.logger.error(`Unable to send DISCOVER packet.`, error);
      this.star.broadcastLocal('$transit.error', {
        error,
        module: 'transit',
        type: C.FAILED_NODES_DISCOVERY
      });
    });
  }

  /**
   * 发现节点
   */
  public discoverNode(nodeID: string) {
    return this.publish(new Packet(PacketTypes.PACKET_DISCOVER, nodeID, {})).catch((error) => {
      this.logger.error(`Unable to send DISCOVER packet to '${nodeID}' node.`, error);
      // 广播
      this.star.broadcastLocal('$transit.error', {
        error,
        module: 'transit',
        type: C.FAILED_NODE_DISCOVERY
      });
    });
  }
}
