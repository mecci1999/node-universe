import { GenericObject } from '@/typings';
import { LoggerBindings, LoggerInstance } from '@/typings/logger';
import { Serialize } from '@/typings/serializers';
import { ServiceSchema, ServiceSettingSchema } from '@/typings/service';
import { MCallCallingOptions, StarCallActionParams, StarMCallActionParams, StarOptions } from '@/typings/star';
import { Transporter } from '@/typings/transit/transporters';
import {
  generateToken,
  getConstructorName,
  getNodeID,
  humanize,
  isFunction,
  isInheritedClass,
  isPlainObject,
  isString,
  polyfillPromise,
  promiseAllControl,
  removeFromArray,
  sleep
} from '@/utils';
import EventEmitter2 from 'eventemitter2';
import _, { isObject } from 'lodash';
import Context from '../context';
import { Regenerator, ServiceNotFoundError, resolveRengerator } from '../error';
import { ServiceNotAvailableError, StarServerError, UniverseError } from '../error/custom';
import { LoggerFactory } from '../logger/factory';
import MiddlewareHandler from '../middleware/handler';
import { Registry } from '../registry';
import Serializers from '../serializers';
import Cachers from '../cachers';
import Transit from '../transit';
import Transporters from '../transporters';
import Validators from '../validators';
import C from './constants';
import { getCpuUsage } from './cpu-usage';
import H from './health';
import getInternalSchema from './internals';
import Service from './service';
import { METRIC, MetricRegistry } from '../metrics';
import { UniverseErrorCode, UniverseErrorOptionsType } from '@/typings/error';
import ServiceItem from '../registry/service-item';
import { ServiceSearchObj } from '@/typings/star/service';
import path from 'path';
import { format } from 'util';
import { Validator } from '@/typings/validator';
import kleur from 'kleur';
import Tracer from '../tracing/tracer';
import { glob } from 'glob';

// 默认选项
const defaultOptions = {
  namespace: '', // 星球命名
  nodeID: null, // 星球id

  logger: true, // 是否启用日志记录
  logLevel: null, // 日志等级分类

  transporter: null, // 通信模块的配置，默认使用TCP协议

  errorRegenerator: null,

  requestTimeout: 0 * 1000, // 请求超时时间
  retryPolicy: {
    enabled: false,
    retries: 5,
    delay: 100,
    maxDelay: 1000,
    factor: 2,
    check: (err) => err && !!err.retryable
  },

  contextParamsCloning: false,
  maxCallLevel: 0,

  heartbeatInterval: 10,
  heartbeatTimeout: 30,

  tracking: {
    enabled: false,
    shutdownTimeout: 5000
  },

  disableBalancer: false,

  registry: {
    strategy: 'RoundRobin',
    preferLocal: true,
    stopDelay: 100,
    discoverer: {
      type: 'Local',
      options: { heartbeatInterval: 10, heartbeatTimeout: 30 }
    }
  },

  circuitBreaker: {
    enabled: false,
    threshold: 0.5,
    windowTime: 60,
    minRequestCount: 20,
    halfOpenTime: 10 * 1000,
    check: (err) => err && err.code >= 500
  },

  bulkhead: {
    enabled: false,
    concurrency: 10,
    maxQueueSize: 100
  },

  transit: {
    maxQueueSize: 50 * 1000, // 50k ~ 400MB,
    maxChunkSize: 256 * 1024, // 256KB
    disableReconnect: false,
    disableVersionCheck: false
  },

  uidGenerator: null,

  errorHandler: null,

  cacher: {
    type: 'Memory',
    clone: true
  },

  serializer: null,

  validator: true,

  metrics: { enabled: false },
  tracing: { enabled: false },

  internalServices: true,
  internalMiddlewares: true, // 是否注册内部中间件

  dependencyInterval: 1000,
  dependencyTimeout: 0,

  hotReload: false,

  middlewares: null,

  replCommands: null,
  replDelimiter: null,

  metadata: {},

  skipProcessEventRegistration: false,

  maxSafeObjectSize: null,
  ServiceFactory: null,
  ContextFactory: null
  // Promise: null
};

// 内置的中间件
const INTERNAL_MIDDLEWARES = [
  'ActionHook',
  'Validator',
  'Bulkhead',
  'Cacher',
  'ContextTracker',
  'CircuitBreaker',
  'Timeout',
  'Retry',
  'Fallback',
  'ErrorHandler',
  'Tracing',
  'Metrics',
  'Debounce',
  'Throttle'
];

export default class Star {
  public static UNIVERSE_VERSION: string = '0.0.1'; // 版本号
  public static PROTOCOL_VERSION: string = '1'; // 协议版本
  public static INTERNAL_MIDDLEWARES: string[] = INTERNAL_MIDDLEWARES;

  public options: StarOptions = {}; // 配置选项
  public namespace: string | null = ''; // 命名
  public nodeID: string | null = ''; // 节点ID
  public metadata: GenericObject = {}; // 元数据
  public instanceID: string = ''; // 实例ID
  public started: boolean = false; // 是否已启动
  public stopping: boolean = false; // 是否正在停止

  public logger: LoggerInstance | null = null;
  public loggerFactory: LoggerFactory | null = null;
  public transit: Transit | null = null;
  public serializer: Serialize | null = null;
  public cacher: any; // 缓存模块
  public errorRegenerator: Regenerator | null = null;
  public ContextFactory: any = null;
  public ServiceFactory: any = null;
  public metrics: MetricRegistry | null = null;
  public registry: Registry | null = null;
  public validator: Validator | null = null;
  public tracer: Tracer | null = null;
  public middlewares: MiddlewareHandler | null = null;
  public services: Service[] = [];

  public _closeFn: any;
  public Promise: any;
  public localBus: EventEmitter2 | null = null;

  constructor(options: StarOptions) {
    try {
      this.options = _.defaultsDeep(options, defaultOptions);

      if (this.options.Promise) {
        this.Promise = this.options.Promise;
      } else {
        this.Promise = Promise;
      }
      // 补充 Promise 方法
      polyfillPromise(this.Promise);
      // Star.Promise = this.Promise;

      this.started = false;
      this.stopping = false;

      this.ServiceFactory = this.options.ServiceFactory || Service;
      this.ContextFactory = this.options.ContextFactory || Context;

      this.namespace = this.options.namespace || '';
      this.metadata = this.options.metadata || {};
      this.nodeID = this.options.nodeID || getNodeID();
      this.instanceID = generateToken();

      this.services = [];

      // 本地通信服务
      this.localBus = new EventEmitter2({ wildcard: true, maxListeners: 100 });

      // 日志模块
      this.loggerFactory = new LoggerFactory(this);
      this.loggerFactory.init(this.options.logger || {});
      this.logger = this.getLogger('star');
      // 启动相关日志
      if (this.logger) {
        this.logger.info(`Universe V${Star.UNIVERSE_VERSION} is starting...`);
        this.logger.info(`Star's namespace: ${this.namespace || '<not defined>'}`);
        this.logger.info(`Star's node ID: ${this.nodeID}`);
      }

      // 性能指标模块
      this.metrics = new MetricRegistry(this, this.options.metrics);
      this.metrics.init();
      // 注册指标参数
      this.registerUniverseMetrics();

      // 中间件处理模块
      this.middlewares = new MiddlewareHandler(this);

      // 服务注册模块
      this.registry = new Registry(this);

      // 缓存模块
      this.cacher = Cachers.resolve(this.options.cacher);
      if (this.cacher) {
        // 初始化缓存模块
        this.cacher.init(this);
        const name = getConstructorName(this.cacher);
        this.logger?.info(`Cacher: ${name}`);
      }

      // 序列化处理模块
      this.serializer = Serializers.resolve(this.options.serializer as any);
      if (this.serializer) (this.serializer as any).init(this);

      // 错误处理机制模块
      this.errorRegenerator = resolveRengerator(this.options.errorRegenerator);
      this.errorRegenerator.init(this);

      if (this.serializer) {
        const serializerName = getConstructorName(this.serializer);
        this.logger?.info(`Serializer: ${serializerName}`);
      }

      // 验证模块
      if (this.options.validator) {
        this.validator = Validators.resolve(this.options.validator);
        if (this.validator) {
          const validatorName = getConstructorName(this.validator);
          this.logger?.info(`Validator: ${validatorName}`);
          this.validator.init(this);
        }
      }

      // 记录、跟踪服务模块
      this.tracer = new Tracer(this, this.options.tracing || {});
      this.tracer.init();

      // 注册中间件
      this.registerMiddlewares(this.options.middlewares);

      // 通信传输模块
      if (this.options.transporter) {
        // 获取通信方式
        const transporter: Transporter = Transporters.resolve(this.options.transporter);
        this.transit = new Transit(this, transporter, this.options.transit);
        const transitName = getConstructorName(transporter);
        this.logger?.info(`Transporter: ${transitName}`);

        if (this.options.disableBalancer) {
          // 禁用负载均衡
          if (transporter.hasBuiltInBalancer) {
            this.logger?.info('The Star built-in balancer is DISABLED');
          } else {
            this.logger?.warn(`The ${transitName} has no built-in balancer. Star balancer is ENABLED.`);
            this.options.disableBalancer = false;
          }
        }
      }

      // 是否禁用负载均衡
      if (this.options.disableBalancer) {
        // 禁用负载均衡模式
        this.call = this.callWithoutBalancer;
      }

      // 防抖处理更新服务数据
      const origLocalServiceChanged = this.localServiceChanged;
      this.localServiceChanged = _.debounce(() => origLocalServiceChanged.call(this), 1000);

      // 服务注册发现模块初始化
      this.registry.init(this);

      // 注册内部动作
      if (this.options.internalServices) {
        this.registerInternalServices(this.options.internalServices);
      }

      // 调用created中间件
      this.callMiddlewareHookSync('created', [this]);

      // 调用options中的created方法
      if (this.options.created && isFunction(this.options.created)) this.options.created(this);

      this._closeFn = () => {
        this.stop()
          .catch((err) => {
            this.logger?.error(err);
          })
          .then(() => process.exit(0));
      };

      // 重置进程的监听器
      process.setMaxListeners(0);

      if (this.options.skipProcessEventRegistration === false) {
        process.on('beforeExit', this._closeFn);
        process.on('exit', this._closeFn);
        process.on('SIGINT', this._closeFn);
        process.on('SIGTERM', this._closeFn);
      }
    } catch (error) {
      // 输出错误日志，并结束程序
      if (this.logger) {
        this.fatal('Unable to create a Star.', error, true);
      } else {
        console.error('Unable to create a Star.', error);
        process.exit(1);
      }
    }
  }

  /**
   * 启动星球，如果通信模块创建了，将会触发通信模块的链接事件
   */
  public start() {
    const startTime = Date.now();

    return Promise.resolve()
      .then(() => {
        return this.callMiddlewareHook('starting', [this]);
      })
      .then(() => {
        if (this.transit) {
          return this.transit.connect().catch((error) => {
            this.logger?.error('Unable to trasit connect ', error);
          });
        }
      })
      .then(() => {
        // 启动所有的服务
        return Promise.all(this.services.map((serivce) => serivce._start.call(serivce))).catch((error) => {
          this.logger?.error('Unable to start all services.', error);
          throw error;
        });
      })
      .then(() => {
        this.started = true;
        // 性能事件
        this.metrics?.set(METRIC.UNIVERSE_STAR_STARTED, 1);
        // 广播
        this.broadcastLocal('$star.started');
      })
      .then(() => {
        if (this.transit) return this.transit.ready();
      })
      .then(() => {
        return this.callMiddlewareHook('started', [this]);
      })
      .then(() => {
        if (this.options.started && isFunction(this.options.started)) return this.options.started(this);
      })
      .then(() => {
        // 启动过程所花费的时间
        const duration = Date.now() - startTime;
        this.logger?.info(
          kleur.green(`✔ Star with ${this.services.length} service(s) started successfully in ${humanize(duration)}`)
        );
      });
  }

  /**
   * 停止
   */
  public stop() {
    this.started = false;
    return Promise.resolve()
      .then(() => {
        if (this.transit) {
          this.registry?.regenerateLocalRawInfo(true, true);
          return this.registry?.discoverer.sendLocalNodeInfo();
        }
      })
      .then(() => {
        if (this.options.registry?.stopDelay) {
          return sleep(this.options.registry.stopDelay);
        }
      })
      .then(() => {
        this.stopping = true;

        return this.callMiddlewareHook('stopping', [this], { reverse: true });
      })
      .then(() => {
        return Promise.all(this.services.map((service) => service._stop.call(service))).catch((error) => {
          this.logger?.error('Unable to stop all services.', error);

          this.broadcastLocal('$star.error', {
            error: error,
            module: 'star',
            type: C.FAILED_STOPPING_SERVICES
          });
        });
      })
      .then(() => {
        if (this.transit) {
          return this.transit.disconnect();
        }
      })
      .then(() => {
        if (this.cacher) {
          return this.cacher.close();
        }
      })
      .then(() => {
        if (this.metrics) {
          return this.metrics.stop();
        }
      })
      .then(() => {
        if (this.tracer) {
          return this.tracer.stop();
        }
      })
      .then(() => {
        return this.registry?.stop();
      })
      .then(() => {
        return this.callMiddlewareHook('stopped', [this], { reverse: true });
      })
      .then(() => {
        if (isFunction(this.options.stopped)) {
          return (this.options.stopped as Function)(this);
        }
      })
      .catch((err) => {
        this.logger?.error(err);
      })
      .then(() => {
        this.logger?.info('Star is stopped. Good bye.');
        this.metrics?.set(METRIC.UNIVERSE_STAR_STARTED, 0);

        this.broadcastLocal('$star.stopped');

        if (this.options.skipProcessEventRegistration === false) {
          // 取消监听器
          process.removeListener('beforeExit', this._closeFn);
          process.removeListener('exit', this._closeFn);
          process.removeListener('SIGINT', this._closeFn);
          process.removeListener('SIGTERM', this._closeFn);
        }
      })
      .then(() => {
        return (this.loggerFactory as LoggerFactory).stop();
      })
      .catch((err) => {
        console.error('Star is stopped falid.', err);
      });
  }

  /**
   * 出现致命错误，抛出错误信息并打印，可以主动选择是否结束程序
   */
  public fatal(message: string, error?: any, needQuit?: boolean) {
    if (this.logger) {
      this.logger.error(message, error);
    } else {
      console.error(message, error);
    }

    if (needQuit !== false) process.exit(1);
  }

  /**
   * 开启控制台输入命令模式
   */
  public repl() {
    let repl: any;

    if (repl) {
      let options: any = null;
      const delimiter = this.options.replDelimiter;
      const customCommands = this.options.replCommands;
      delimiter && (options = { delimiter });
      customCommands && (options = { ...options, customCommands });

      return repl(this, options);
    }
  }

  /**
   * 获取一个自定义的日志模块
   */
  public getLogger(mod: string, props?: any) {
    let bindings = Object.assign({ nodeID: this.nodeID, namespace: this.namespace, mod }, props) as LoggerBindings;

    return this.loggerFactory && this.loggerFactory.getLogger(bindings);
  }

  /**
   * 全局错误处理器
   */
  public errorHandler(error: Error, info: any) {
    if (this.options.errorHandler) {
      return this.options.errorHandler.call(this, error, info);
    }

    throw error;
  }

  /**
   * 生成uuid
   */
  public generateUid(): string {
    if (this.options.uidGenerator) return this.options.uidGenerator.call(this);

    return generateToken();
  }

  /**
   * 找到下一个动作的可用端点
   */
  public findNextActionEndpoint(actionName: string, options: GenericObject, context: Context) {
    if (typeof actionName !== 'string') {
      return actionName;
    } else {
      if (options && options.nodeID) {
        const nodeID = options.nodeID;
        // 找到端点
        const endpoint = this.registry?.getActionEndpointByNodeId(actionName, nodeID);

        if (!endpoint) {
          this.logger?.warn(`Service '${actionName}' is not found on '${nodeID}' node.`);
          return new ServiceNotFoundError({ action: actionName, nodeID });
        }
        return endpoint;
      } else {
        const epList = this.registry?.getActionEndpoints(actionName);
        if (!epList) {
          this.logger?.warn(`Service '${actionName}' is not registered.`);
          return new ServiceNotFoundError({ action: actionName });
        }

        // 得到下一个端点
        const endpoint = epList.next(context);
        if (!endpoint) {
          const errMsg = `Service '${actionName}' is not available.`;
          this.logger?.warn(errMsg);
          return new ServiceNotFoundError({ action: actionName });
        }
        return endpoint;
      }
    }
  }

  /**
   * 动作通信
   */
  public call(actionName: string, params?: GenericObject, options?: GenericObject): Promise<any> {
    if (params == undefined) params = {};

    // 创建上下文
    let ctx: Context;
    if (options && options.ctx != null) {
      // 找到动作的下一个端点
      const endpoint = this.findNextActionEndpoint(actionName, options, options.ctx);
      if (endpoint instanceof Error) {
        return Promise.reject(endpoint).catch((error) => this.errorHandler(error, { actionName, params, options }));
      }

      ctx = options.ctx;
      ctx.endpoint = endpoint;
      ctx.nodeID = endpoint.id;
      ctx.action = endpoint.action;
      ctx.service = endpoint.action?.service || null;
    } else {
      // 创建新根上下文
      ctx = this.ContextFactory?.create(this, null, params, options) as Context;
      // 找到下一个端点
      const endpoint = this.findNextActionEndpoint(actionName, options || {}, ctx);
      if (endpoint instanceof Error) {
        return Promise.reject(endpoint).catch((error) => this.errorHandler(error, { actionName, params, options }));
      }
      // 设置上下文的端口
      ctx.setEndpoint(endpoint);
    }
    // 上下文的端口是否为本地
    if (ctx.endpoint?.local) {
      this.logger?.debug('Call action locally.', {
        action: ctx.action?.name,
        requestID: ctx.requestID
      });
    } else {
      this.logger?.debug('Call action on remote node.', {
        action: ctx.action?.name,
        nodeID: ctx.nodeID,
        requestID: ctx.requestID
      });
    }

    if (!ctx.endpoint?.action?.handler)
      return Promise.reject(new UniverseError('star call action is error, ctx endpoint action handle is undefined.'));

    // 端口处理的结果
    let p = ctx.endpoint.action.handler(ctx);
    p.ctx = ctx;

    return p;
  }

  /**
   * 不使用负载均衡的通信
   */
  public callWithoutBalancer(actionName: string, params?: GenericObject, options: GenericObject = {}): Promise<any> {
    if (params === undefined) params = {};

    let nodeID: string | null = null;
    let endpoint: any = null;
    if (typeof actionName !== 'string') {
      endpoint = actionName;
      actionName = endpoint.action.name;
      nodeID = endpoint.id;
    } else {
      if (options.nodeID) {
        nodeID = options.nodeID;
        endpoint = this.registry?.getActionEndpointByNodeId(actionName, nodeID as string);
        if (!endpoint) {
          // 没有找到端口
          this.logger?.warn(`Service '${actionName}' is not found on '${nodeID}' node.`);
          return Promise.reject(new ServiceNotFoundError({ action: actionName, nodeID: nodeID || '' })).catch(
            (error) => {
              this.errorHandler(error, { nodeID, actionName, params, options });
            }
          );
        } else {
          // 找到了端口
          // 通过动作名获取端口列表
          const endpointList = this.registry?.getActionEndpoints(actionName);
          if (endpointList == null) {
            // 没有获取到端口
            this.logger?.warn(`Service '${actionName}' is not registered.`);
            // 报错
            Promise.reject(new ServiceNotFoundError({ action: actionName })).catch((error) => {
              this.errorHandler(error, { actionName, params, options });
            });
          }
          endpoint = endpointList?.getFirst();
          if (endpoint == null) {
            // 没有拿到第一个端口
            const errorMsg = `Service '${actionName}' is not available.`;
            this.logger?.warn(errorMsg);
            return Promise.reject(new ServiceNotAvailableError({ action: actionName })).catch((error) => {
              this.errorHandler(error, { actionName, params, options });
            });
          }
        }

        // 得到了端口，创建需要通信的上下文实例
        let ctx: Context;
        if (options.ctx != null) {
          // 重复使用之前的上下文
          ctx = options.ctx;
          if (endpoint) {
            ctx.endpoint = endpoint;
            ctx.action = endpoint.action;
          }
        } else {
          // 没有可以重复使用的上下文
          ctx = this.ContextFactory?.create(this, endpoint, params, options) as Context;
        }
        ctx.nodeID = nodeID;
        // 日志
        this.logger?.debug('Call action on a node.', {
          action: ctx?.action?.name,
          nodeID: ctx.nodeID,
          requestID: ctx.requestID
        });
        // 端口动作中的远程处理器
        let p = endpoint.action.remoteHandler(ctx);
        p.ctx = ctx;

        return p as Promise<any>;
      }
    }

    return Promise.resolve();
  }

  /**
   * 获取本地动作节点
   */
  public _getLocalActionEndpoint(actionName: string, ctx?: Context) {
    // 通过动作名获取动作
    let epList = this.registry?.getActionEndpoints(actionName);
    if (epList == null || !epList?.hasLocal()) {
      // 没有本地的动作
      this.logger?.warn(`Service '${actionName}' is not registered locally.`);
      throw new ServiceNotFoundError({ action: actionName, nodeID: `${this.nodeID}` });
    }

    // 获取本地节点
    let endpoint = epList.nextLocal(ctx);
    if (!endpoint) {
      // 没有获取到有效节点
      this.logger?.warn(`Service '${actionName}' is not available locally.`);
      throw new ServiceNotAvailableError({ action: actionName, nodeID: `${this.nodeID}` });
    }

    return endpoint;
  }

  /**
   * 多个动作通信
   *
   * 例子: 传入一个动作数组
   * ``` js
   * start.mcall([
   * { action: 'posts.find', params: { limit: 5, offsetL 0 } },
   * { action: 'users.find', params: { limit: 5, sort: 'username' }, opts: { timeout: 500 } },
   * ]).then(results => {
   *    let posts = results[0];
   *    let users = results[1];
   * })
   * ```
   *
   * 例子: 传入一个动作对象
   * ``` js
   * start.mcall({
   * posts: { action: 'posts.find', params: { limit: 5, offsetL 0 } },
   * users: { action: 'users.find', params: { limit: 5, sort: 'username' }, opts: { timeout: 500 } },
   * ).then(results => {
   *    let posts = results[0];
   *    let users = results[1];
   * })
   * ```
   */
  public mcall(
    def: Array<StarMCallActionParams> | Record<string, StarMCallActionParams>,
    opts: MCallCallingOptions = {}
  ): Promise<any[] | GenericObject> {
    const { settled, ...options } = opts;

    if (Array.isArray(def)) {
      return promiseAllControl(
        def.map((item) => this.call(item.action, item.params, item.options || options)),
        settled || true
      );
    } else if (isObject(def)) {
      let results = {};
      let promises = Object.keys(def).map((name) => {
        const item = def[name];
        const callOptions = item.options || options;

        return this.call(item.action, item.params, callOptions).then((res) => (results[name] = res));
      });
      let p = promiseAllControl(promises, settled || true);
      (p as any).ctx = promises.map((promise) => (promise as any).ctx);

      return p.then(() => results);
    } else {
      return Promise.reject(
        new StarServerError(
          'Invalid calling definition.',
          UniverseErrorCode.SERVICE_ERROR,
          UniverseErrorOptionsType.INVALID_PARAMETERS
        )
      );
    }
  }

  /**
   * 获取实例名
   * @param obj
   * @returns
   */
  public getConstructorName(obj: any) {
    return getConstructorName(obj);
  }

  /**
   * 获取节点cpu数据
   */
  public getCpuUsage() {
    return getCpuUsage();
  }

  /**
   * 本地节点广播通知
   */
  public broadcastLocal(eventName: string, payload?: any, options?: GenericObject): Promise<void> {
    if (Array.isArray(options) || isString(options)) options = { groups: options };
    else if (options == null) options = {};

    if (options.groups && !Array.isArray(options.groups)) options.groups = [options.groups];

    this.logger?.debug(
      `Broadcast '${eventName}' local event` + (options.groups ? ` to ${options.groups.join(',')} group(s)` : '') + '.'
    );

    if (/^\$/.test(eventName)) this.localBus?.emit(eventName, payload);

    //  创建上下文
    const ctx = this.ContextFactory?.create(this, null, payload, options);
    ctx?.setContextEventData({ eventName, eventType: 'broadcastLocal', eventGroups: options.groups });

    if (!ctx) return Promise.reject(new UniverseError('star broadcastLocal action is error, ctx is undefined'));

    return this.emitLocalServices(ctx);
  }

  /**
   * 广播至所有的节点
   */
  public broadcast(eventName: string, payload?: any, options?: GenericObject) {
    if (Array.isArray(options) || isString(options)) options = { groups: options };
    else if (options == null) options = {};

    if (options.groups && !Array.isArray(options.groups)) {
      options.groups = [options.groups];
    }

    const promises: Promise<any>[] = [];

    this.logger?.debug(
      `Boardcast '${eventName}' event` + (options.groups ? ` to '${options.groups.join(', ')}' group(s)` : '') + '.'
    );

    if (this.transit) {
      // 创建上下文
      const ctx = this.ContextFactory?.create(this, null, payload, options);
      ctx?.setContextEventData({ eventName, eventType: 'boardcast', eventGroups: options.groups });

      // 是否开启负载均衡
      if (!this.options.disableBalancer) {
        // 开启了负载均衡
        const endpoints = this.registry?.events.getAllEndpoints(eventName, options.groups);
        endpoints?.forEach((ep) => {
          if (ep.id !== this.nodeID) {
            const newCtx = ctx?.copy(ep);
            if (!newCtx) return;
            this.transit && promises.push(this.transit?.sendEvent(newCtx));
          }
        });
      } else {
        // 没有使用负载均衡
        let groups = options.groups;
        if (!groups || groups.length === 0) {
          groups = this.getEventGroups(eventName);
        }
        if (groups.length === 0) return;
        const endpoints = this.registry?.events.getAllEndpoints(eventName);
        if (!endpoints || endpoints.length === 0) return;

        return Promise.all(
          endpoints?.map((ep) => {
            const newCtx = ctx?.copy(ep);
            newCtx?.setContextEventData({ eventGroups: groups });
            if (!newCtx) return;
            return this.transit?.sendEvent(newCtx);
          })
        );
      }
    }

    // 没有通信服务，则发送给本地的服务
    promises.push(this.broadcastLocal(eventName, payload, options));

    return Promise.all(promises);
  }

  /**
   * emit动作
   */
  public emit(eventName: string, payload?: any, options?: GenericObject) {
    if (Array.isArray(options) || isString(options)) options = { groups: options };
    else if (options == null) options = {};

    if (options.groups && !Array.isArray(options.groups)) options.groups = [options.groups];

    const promises: Promise<any>[] = [];
    const ctx = this.ContextFactory?.create(this, null, payload, options);
    ctx?.setContextEventData({ eventName, eventType: 'emit', eventGroups: options.groups });
    this.logger?.debug(
      `Emit '${eventName}' event` + (options.groups ? ` to '${options.groups.join(', ')}' group(s)` : '')
    ) + '.';
    if (/^\$/.test(eventName)) this.localBus?.emit(eventName, payload);
    if (!this.options.disableBalancer && ctx) {
      // 负载均衡
      const endpoints = this.registry?.events.getBalancedEndpoints(eventName, options.groups, ctx);
      const groupedEP = {};
      endpoints?.forEach(([ep, group]) => {
        if (ep.id === this.nodeID) {
          // 本地服务
          const newCtx = ctx.copy(ep);
          promises.push(this.registry?.events.callEventHandler(newCtx));
        } else {
          // 远程服务
          const e = groupedEP[ep.id];
          if (e) e.groups.push(group);
          else groupedEP[ep.id] = { ep, groups: [group] };
        }
      });

      if (this.transit) {
        _.forIn(groupedEP, (item: any) => {
          const newCtx = ctx.copy(item.ep);
          newCtx.setContextEventData({ eventGroups: item.groups });
          this.transit && promises.push(this.transit?.sendEvent(newCtx));
        });
      }

      return Promise.all(promises);
    } else if (this.transit) {
      // 禁用负载均衡
      let groups = options.groups;
      if (!groups || groups.length === 0) {
        groups = this.getEventGroups(eventName);
      }
      if (groups.length === 0) return Promise.resolve();
      ctx?.setContextEventData({ eventGroups: groups });
      if (!ctx) Promise.reject(new UniverseError('star emit action is error, ctx is undefined'));
      return this.transit.sendEvent(ctx as Context);
    }
  }

  /**
   * 触发事件到本地的节点，主要是用来远程通信一个事件
   */
  public emitLocalServices(ctx: Context): Promise<any> {
    if (!this.registry)
      return Promise.reject(
        new UniverseError('star emitLocalServices action is error, star registry module is undefined')
      );

    return this.registry?.events.emitLocalServices(ctx);
  }

  /**
   * 发送ping命令给一个节点
   */
  public ping(nodeID: string | string[], timeout: number = 2000) {
    if (this.transit && this.transit.connected) {
      // 通信模块已建立连接
      if (isString(nodeID)) {
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            this.localBus?.off('$node.pong', handler);
            resolve(null);
          }, timeout);

          const handler = (pong) => {
            if (pong.nodeID == nodeID) {
              clearTimeout(timer);
              this.localBus?.off('$node.pong', handler);
              resolve(pong);
            }
          };

          this.localBus?.on('$node.pong', handler);

          this.transit?.sendPing(nodeID as string);
        });
      } else {
        const pongs = {};
        let nodes = nodeID as string[];

        if (!nodes) {
          nodes =
            this.registry
              ?.getNodeList({ onlyAvaiable: true, withServices: false })
              .filter((node) => node.id !== this.nodeID)
              .map((node) => node.id) || [];
        }

        nodes.forEach((id) => (pongs[id] = null));
        const processing = new Set(nodes);

        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            this.localBus?.off('$node.pong', handler);
            resolve(pongs);
          }, timeout);

          const handler = (pong) => {
            pongs[pong.nodeID] = pong;
            processing.delete(pong.nodeID);

            if (processing.size === 0) {
              clearTimeout(timer);
              this.localBus?.off('$node.pong', handler);
              resolve(pongs);
            }
          };

          this.localBus?.on('$node.pong', handler);

          nodes.forEach((id) => this.transit?.sendPing(id));
        });
      }
    }

    return Promise.resolve(nodeID ? null : []);
  }

  /**
   * 是否禁用指标注册
   */
  public isMetricsEnabled() {
    return this.metrics?.isEnabled();
  }

  /**
   * 注册Universe相关的指标
   */
  private registerUniverseMetrics() {
    if (!this.isMetricsEnabled()) return;

    // ------ UNIVERSE NODE METRICS ------

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_NODE_TYPE,
        type: METRIC.TYPE_INFO,
        description: 'Universe运行环境类型'
      })
      ?.set('nodejs');

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_NODE_VERSIONS_UNIVERSE,
        type: METRIC.TYPE_INFO,
        description: 'Universe版本号'
      })
      ?.set(Star.UNIVERSE_VERSION);

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_NODE_VERSIONS_PROTOCOL,
        type: METRIC.TYPE_INFO,
        description: 'Universe协议版本号'
      })
      ?.set(Star.PROTOCOL_VERSION);

    // ------ UNIVERSE STAR METRICS ------

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_STAR_NAMESPACE,
        type: METRIC.TYPE_INFO,
        description: '星球的名字'
      })
      ?.set(this.namespace || '<not defined>');

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_STAR_STARTED,
        type: METRIC.TYPE_GAUGE,
        description: '星球开始运转'
      })
      ?.set(0);

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_STAR_LOCAL_SERVICES_TOTAL,
        type: METRIC.TYPE_GAUGE,
        description: '星球的服务人造卫星数量'
      })
      ?.set(0);

    this.metrics
      ?.register({
        name: METRIC.UNIVERSE_STAR_MIDDLEWARES_TOTAL,
        type: METRIC.TYPE_GAUGE,
        description: '星球的人造卫星中间件数量'
      })
      ?.set(0);
  }

  /**
   * 检查跟踪模块是否被禁用
   */
  public isTracingEnabled() {
    return this.tracer?.isEnabled();
  }

  /**
   * 注册中间件
   */
  public registerMiddlewares(userMiddlewares: any) {
    if (Array.isArray(userMiddlewares) && userMiddlewares.length > 0) {
      _.compact(userMiddlewares).forEach((middleware) => this.middlewares?.add(middleware));
    }

    if (this.options.internalMiddlewares) {
      INTERNAL_MIDDLEWARES.forEach((midlleware) => this.middlewares?.add(midlleware));

      if (this.options.hotReload) {
        this.middlewares?.add('HotReload');
      }
    }

    this.logger?.info(`Registered ${this.middlewares?.count()} middleware(s).`);

    this.createService = this.wrapMethod('createService', this.createService) as any;
    this.registerLocalService = this.wrapMethod('registerLocalService', this.registerLocalService) as any;
    this.destroyService = this.wrapMethod('destroyService', this.destroyService) as any;
    this.call = this.wrapMethod('call', this.call) as any;
    this.mcall = this.wrapMethod('mcall', this.mcall) as any;
    this.callWithoutBalancer = this.wrapMethod('call', this.callWithoutBalancer) as any;
    this.emit = this.wrapMethod('emit', this.emit) as any;
    this.broadcast = this.wrapMethod('broadcast', this.broadcast) as any;
    this.broadcastLocal = this.wrapMethod('broadcastLocal', this.broadcastLocal) as any;

    this.metrics?.set(METRIC.UNIVERSE_STAR_MIDDLEWARES_TOTAL, this.middlewares?.count());
  }

  /**
   * 封装方法
   */
  public wrapMethod(name: string, handler: Function, bindTo?: any, options?: Object) {
    return this.middlewares?.wrapMethod(name, handler, bindTo, options);
  }

  /**
   * 在所有的中间件中使用异步通信处理器
   */
  public callMiddlewareHook(name: string, args: Array<any>, options?: any) {
    return this.middlewares?.callHandlers(name, args, options);
  }

  /**
   * 所用的中间件同步通信处理器
   */
  public callMiddlewareHookSync(name: string, args: Array<any>, options?: any) {
    return this.middlewares?.callSyncHandlers(name, args, options);
  }

  /**
   * 获得本地节点信息
   */
  public getLocalNodeInfo() {
    return this.registry?.getLocalNodeInfo();
  }

  /**
   * 获取健康状态
   */
  public getHealthStatus() {
    return H.getHealthStatus();
  }

  public getEventGroups(eventName: string) {
    return this.registry?.events.getGroups(eventName);
  }

  /**
   * 是否存在事件监听器
   */
  public hasEventListener(eventName: string) {
    const endpoints = this.registry?.events.getAllEndpoints(eventName);

    if (endpoints?.length) {
      return endpoints.length > 0;
    }

    return false;
  }

  /**
   * 获取事件监听器
   */
  public getEventListeners(eventName: string) {
    return this.registry?.events.getAllEndpoints(eventName);
  }

  // --------------------------------  服务相关的方法  ----------------------------------------

  /**
   * 根据协议创建一个服务
   */
  public createService(schema: any, schemaMods?: any) {
    let service: any;

    // 根据创建的服务去生成一个标准的服务类
    schema = this.normalizeSchemaConstructor(schema);

    if (Object.prototype.isPrototypeOf.call(this.ServiceFactory, schema)) {
      service = new schema(this, schemaMods);
    } else {
      service = new this.ServiceFactory(this, schema, schemaMods);
    }

    if (this.started) this._restarService(service);

    return service;
  }

  /**
   * 注册本地一个本地服务
   */
  public registerLocalService(registryItem: ServiceItem) {
    this.registry?.registerLocalService(registryItem);

    return null;
  }

  /**
   * 销毁一个本地服务
   */
  public destroyService(service: string | Service | GenericObject) {
    let serviceName: string = '';
    let serviceVersion: string = '';

    if (isString(service)) {
      serviceName = service as string;
      service = this.getLocalService(service as string) as any;
    } else if (isPlainObject(service)) {
      // 对象
      serviceName = (service as GenericObject).name;
      serviceVersion = (service as GenericObject).version;
      service = this.getLocalService((service as GenericObject).name, (service as GenericObject).version) as any;
    }

    if (!service) {
      return Promise.reject(new ServiceNotFoundError({ name: serviceName, version: serviceVersion }));
    }

    return Promise.resolve()
      .then(() => (service as Service)._stop())
      .catch((err) => {
        this.logger?.error(`Unable to stop '${(service as Service).fullName}' service.`, err);

        // 广播事件
        this.broadcastLocal('$star.error', {
          error: err,
          module: 'star',
          type: C.FAILED_DESTRUCTION_SERVICE
        });
      })
      .then(() => {
        removeFromArray(this.services, service);
        // 取消订阅的服务
        this.registry?.unregisterService((service as Service).fullName, `${this.nodeID}`);

        this.logger?.info(`Service '${(service as Service).fullName}' is stopped.`);
        // 更新本地服务数据
        this.servicesChanged(true);
        // 指标数据
        this.metrics?.set(METRIC.UNIVERSE_STAR_LOCAL_SERVICES_TOTAL, this.services.length);
      });
  }

  /**
   * 获得一个本地的服务通过服务名
   *
   * 例子：
   *  getLocalService('v2.ports')
   *  getLocalService({ name: 'posts', version: 2 })
   */
  public getLocalService(name: string | ServiceSearchObj, version?: string | number) {
    if (arguments.length === 1) {
      if (isString(name)) {
        return this.services.find((service) => service.fullName === name);
      } else if (isPlainObject(name)) {
        // 对象参数
        return this.services.find(
          (service) =>
            service.name === (name as ServiceSearchObj).name && service.version === (name as ServiceSearchObj).version
        );
      }
    }

    return this.services.find((service) => service.name === name && service.version === version);
  }

  /**
   * 重新启动服务
   * @param service
   * @returns
   */
  public _restarService(service: Service) {
    return service._start.call(service).catch((error) => {
      this.logger?.error('Unable to start service.', error);
      this.broadcastLocal('$star.error', {
        error,
        module: 'star',
        type: C.FAILED_RESTART_SERVICE
      });
    });
  }

  /**
   * 确保服务协议基于服务类
   */
  public normalizeSchemaConstructor(schema: any) {
    // 满足继承服务类条件
    if (Object.prototype.isPrototypeOf.call(this.ServiceFactory, schema)) {
      return schema;
    }

    let serviceName = getConstructorName(this.ServiceFactory);
    let target = getConstructorName(schema);

    if (serviceName === target) {
      Object.setPrototypeOf(schema, this.ServiceFactory);
      return schema;
    }

    target = getConstructorName(Object.getPrototypeOf(schema));

    if (serviceName === target) {
      Object.setPrototypeOf(Object.getPrototypeOf(schema), this.ServiceFactory);
      return schema;
    }

    if (schema._isMockFunction) {
      target = getConstructorName(Object.getPrototypeOf(schema.prototype));
      if (serviceName === target) {
        Object.setPrototypeOf(schema, this.ServiceFactory);
        return schema;
      }
    }

    return schema;
  }

  /**
   * 添加本地服务
   */
  public addLocalService(service: Service<ServiceSettingSchema>) {
    this.services.push(service);
    // 注册性能指标
    this.metrics?.set(METRIC.UNIVERSE_STAR_LOCAL_SERVICES_TOTAL, this.services.length);
  }

  /**
   * 当有新增的本地服务或者远程服务时，需要调用该方法
   * @param localService 是否是本地服务
   */
  public servicesChanged(localService: boolean) {
    this.broadcastLocal('$services.changed', { localService });
    if (localService && this.transit) {
      this.localServiceChanged();
    }
  }

  /**
   * 发送一个信息包给远程的节点
   */
  public localServiceChanged() {
    if (!this.stopping) {
      this.registry?.discoverer.sendLocalNodeInfo();
    }
  }

  /**
   * 注册内部服务
   */
  public registerInternalServices(
    options:
      | boolean
      | {
          [key: string]: Partial<ServiceSchema>;
        }
  ) {
    options = isObject(options) ? options : {};

    const internalsSchema = getInternalSchema(this);
    let definitiveSchema: any = {};

    if (options['$node']) {
      definitiveSchema = options['$node'];
      if (!definitiveSchema.mixins) definitiveSchema.mixins = [];
      definitiveSchema.mixins.push(internalsSchema);
    } else {
      definitiveSchema = internalsSchema;
    }

    this.createService(definitiveSchema);
  }

  /**
   * 等待其他的服务
   */
  public waitForServices(
    serviceNames: any | any[],
    timeout: number | undefined = this.options.dependencyTimeout,
    interval: number | undefined = this.options.dependencyInterval,
    logger: LoggerInstance | null = this.logger
  ) {
    if (!Array.isArray(serviceNames)) serviceNames = [serviceNames];

    serviceNames = _.uniq(
      _.compact(
        serviceNames.map((item) => {
          if (isPlainObject(item) && item?.name) {
            if (item?.version && Array.isArray(item.version)) {
              return item.version.map((version) => this.ServiceFactory.getVersionedFullName(item.name, version));
            } else {
              return this.ServiceFactory.getVersionedFullName(item.name, item.version);
            }
          } else if (isString(item)) {
            return item;
          }
        })
      )
    );

    if (serviceNames?.length === 0) return Promise.resolve({ services: [], statuses: [] });

    logger?.info(
      `Waiting for service(s) ${serviceNames.map((n) => (Array.isArray(n) ? n.join(' OR ') : n)).join(', ')}'...`
    );

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        // 获得服务状态
        const serviceStatuses = serviceNames.map((name: string | string[]) => {
          if (Array.isArray(name)) {
            return name.map((n) => ({ name: n, available: this.registry?.hasService(n) }));
          } else {
            return { name, available: this.registry?.hasService(name) };
          }
        });

        // 扁平化
        const flattenedStatuses = _.flatMap(serviceStatuses, (s) => s);
        const names = flattenedStatuses.map((s) => s.name);
        // 过滤状态不对的服务
        const availableServices = flattenedStatuses.filter((s) => s.available);
        const isReady = serviceStatuses.every((status) =>
          Array.isArray(status) ? status.some((n) => n.available) : status.available
        );

        if (isReady) {
          logger?.info(`Service(s) '${availableServices.map((s) => s.name).join(', ')}' are available.`);

          return resolve({ services: names, statuses: flattenedStatuses });
        }

        const unavailableServices = flattenedStatuses.filter((s) => !s.available);
        logger?.debug(
          format(
            '%d (%s) %d services are available. %d (%s) are still unavailable. Waiting further...',
            availableServices.length,
            availableServices.map((s) => s.name).join(', '),
            serviceStatuses.length,
            unavailableServices.length,
            unavailableServices.map((s) => s.name).join(', ')
          )
        );

        if (timeout && Date.now() - startTime > timeout) {
          // 超时
          return reject(
            new StarServerError(
              'Services waiting is timed out.',
              UniverseErrorCode.SERVICE_ERROR,
              UniverseErrorOptionsType.WAITFOR_SERVICES,
              { services: names, statuses: flattenedStatuses }
            )
          );
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * 通过上传文件加载服务
   */
  public loadServices(folder: string = './services', fileMask: string = '**/*.service.js') {
    // 日志
    this.logger?.debug(`Search services in '${folder}/${fileMask}'...`);

    let servicesFiles: Array<any>;

    if (Array.isArray(fileMask)) {
      servicesFiles = fileMask.map((f) => path.join(folder, f));
    } else {
      servicesFiles = glob.sync(path.join(folder, fileMask));
    }

    if (servicesFiles) {
      servicesFiles.forEach((filename) => this.loadService(filename));
    }

    return servicesFiles.length;
  }

  /**
   * 通过文件路径，加载服务
   */
  public loadService(filePath: string) {
    let fileName: string, schema: any;

    try {
      // 得到文件的绝对路径
      fileName = require.resolve(path.resolve(filePath));
      this.logger?.debug(`Load Service '${path.basename(fileName)}'`);
      // 引入文件
      const r = require(fileName);
      schema = r.default != null ? r.default : r;

      let service: any;

      // 解析并转换服务协议
      schema = this.normalizeSchemaConstructor(schema);

      if (isInheritedClass(schema, this.ServiceFactory)) {
        // 服务类
        service = new schema(this);

        // 如果微服务已启动，则将重新启动服务
        if (this.started) {
          this._restarService(service);
        }
      } else if (isFunction(schema)) {
        // 方法
        service = schema(this);

        if (!isInheritedClass(service, this.ServiceFactory)) {
          service = this.createService(service);
        } else {
          if (this.started) {
            this._restarService(service);
          }
        }
      } else if (schema) {
        service = this.createService(schema);
      }

      if (service) {
        service.__filename = fileName;
      }

      return service;
    } catch (error) {
      this.logger?.error(`Failed to load service '${filePath}'`, error);
      this.broadcastLocal('$star.error', {
        error,
        module: 'star',
        type: C.FAILED_LOAD_SERVICE
      });

      throw error;
    }
  }
}
