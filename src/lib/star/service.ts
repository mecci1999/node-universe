import { GenericObject } from '@/typings';
import { UniverseErrorCode, UniverseErrorOptionsType } from '@/typings/error';
import { LoggerInstance } from '@/typings/logger';
import { ServiceSchema as OriginalServiceSchema, ServiceDependency, ServiceSettingSchema } from '@/typings/service';
import { ServiceActions } from '@/typings/star/service';
import {
  BoundaryChecker,
  CloneOptimizer,
  deprecate,
  EnhancedErrorHandler,
  functionArguments,
  InputValidator,
  isFunction,
  isNewSignature,
  isObject,
  performanceMonitor,
  promiseMethod,
  SecurityChecker,
  TypeValidator,
  wrapToArray,
  wrapToHandler
} from '@/utils';
import _, { flatten } from 'lodash';
import Star from '.';
import { ServiceSchemaError, UniverseError } from '../error';
import ServiceItem from '../registry/service-item';

export default class Service<S = ServiceSettingSchema> {
  public star: Star;
  public fullName: string = '';
  public name: string = '';
  public version: string | number = '';
  public settings?: ServiceSettingSchema | GenericObject;
  public schema?: OriginalServiceSchema<S>; // 协议
  public metadata: GenericObject = {};
  public logger: LoggerInstance | null = null;
  public actions: ServiceActions | null = null; // 动作
  public events: any; // 事件
  public originalSchema: OriginalServiceSchema<S> | null = null;
  public dependencies: string | ServiceDependency | (string | ServiceDependency)[] | null = null;
  public _serviceSpecification: GenericObject = {};

  constructor(star: Star, schema?: OriginalServiceSchema<S>, schemaMods?: any) {
    // 增强错误处理：验证Star实例
    if (!isObject(star)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        'Star实例创建失败',
        {
          expectedType: 'Star instance',
          actualValue: star,
          suggestions: [
            '请确保传入有效的Star实例',
            '检查Star类是否正确初始化',
            '验证Star构造函数的参数'
          ]
        }
      );
    }

    this.star = star;

    // 日志记录：服务构造开始
    const tempLogger = star.getLogger('Service', {});

    if (schemaMods) {
      deprecate(
        'schemaMods',
        "Using 'schemaMods' parameter in 'star.createService' is deprecated. Use 'mixins' instead."
      );
      // 合并服务参数
      schema = this.mergeSchemas(schema, schemaMods);
    }

    if (schema) {
      // 日志记录：开始验证服务模式

      // 增强错误处理：验证服务模式
      if (!isObject(schema)) {
        tempLogger?.error('服务模式类型验证失败', {
          expectedType: 'object',
          actualType: typeof schema,
          actualValue: schema
        });
        throw EnhancedErrorHandler.createServiceSchemaError(
          '服务模式必须是对象类型',
          {
            expectedType: 'object',
            actualValue: schema,
            suggestions: [
              '确保传入的schema是一个有效的对象',
              '检查schema的定义和结构',
              '参考服务模式的文档说明'
            ]
          },
          this.logger || undefined
        );
      }
      
      // 运行时类型验证

      if (!TypeValidator.validateServiceSchema(schema)) {
        tempLogger?.error('服务模式结构验证失败', {
          serviceName: schema.name || 'unknown',
          schemaStructure: {
            hasName: !!schema.name,
            hasActions: !!schema.actions,
            hasMethods: !!schema.methods,
            hasEvents: !!schema.events
          }
        });
        throw EnhancedErrorHandler.createServiceSchemaError(
          '服务模式结构验证失败',
          {
            serviceName: schema.name || 'unknown',
            expectedType: 'valid ServiceSchema',
            actualValue: schema,
            suggestions: [
              '确保schema包含必需的name属性',
              '检查所有属性的类型是否正确',
              '验证methods、actions、events的定义格式'
            ]
          },
          this.logger || undefined
        );
      }

      // 服务模式结构验证通过
      
      // 输入验证
      const nameValidation = InputValidator.validateServiceName(schema.name);
      if (!nameValidation.isValid) {
        throw EnhancedErrorHandler.createServiceSchemaError(
          '服务名称验证失败',
          {
            serviceName: schema.name,
            schemaProperty: 'name',
            expectedType: 'valid service name',
            actualValue: schema.name,
            suggestions: nameValidation.errors
          },
          this.logger || undefined
        );
      }
      
      if (schema.version !== undefined) {
        const versionValidation = InputValidator.validateVersion(schema.version);
        if (!versionValidation.isValid) {
          throw EnhancedErrorHandler.createServiceSchemaError(
            '版本号验证失败',
            {
              serviceName: schema.name,
              schemaProperty: 'version',
              expectedType: 'valid version',
              actualValue: schema.version,
              suggestions: versionValidation.errors
            },
            this.logger || undefined
          );
        }
      }
      
      // 验证依赖项
      if (schema.dependencies !== undefined) {
        const depsValidation = InputValidator.validateDependencies(schema.dependencies);
        if (!depsValidation.isValid) {
          throw EnhancedErrorHandler.createServiceSchemaError(
            '依赖项验证失败',
            {
              serviceName: schema.name,
              schemaProperty: 'dependencies',
              expectedType: 'valid dependencies',
              actualValue: schema.dependencies,
              suggestions: depsValidation.errors
            },
            this.logger || undefined
          );
        }
      }
      
      // 验证设置和元数据
      if (schema.settings !== undefined) {
        const settingsValidation = InputValidator.validateSettings(schema.settings);
        if (!settingsValidation.isValid) {
          throw EnhancedErrorHandler.createServiceSchemaError(
            '设置验证失败',
            {
              serviceName: schema.name,
              schemaProperty: 'settings',
              expectedType: 'valid settings object',
              actualValue: schema.settings,
              suggestions: settingsValidation.errors
            },
            this.logger || undefined
          );
        }
      }
      
      if (schema.metadata !== undefined) {
        const metadataValidation = InputValidator.validateMetadata(schema.metadata);
        if (!metadataValidation.isValid) {
          throw EnhancedErrorHandler.createServiceSchemaError(
            '元数据验证失败',
            {
              serviceName: schema.name,
              schemaProperty: 'metadata',
              expectedType: 'valid metadata object',
              actualValue: schema.metadata,
              suggestions: metadataValidation.errors
            },
            this.logger || undefined
          );
        }
      }
      
      this.parseServiceSchema(schema);
    }
  }

  /**
   * 获取详细名字
   * @param name
   * @param version
   * @returns
   */
  public static getVersionedFullName(name: string, version?: string | number) {
    if (version) {
      return (typeof version == 'number' ? 'v' + version : version) + '.' + name;
    }

    return name;
  }

  /**
   * 解析服务协议，并注册本地服务
   * @param schema
   */
  private parseServiceSchema(schema: any) {
    // 开始解析服务协议

    // 验证和预处理模式
    schema = this._validateAndPreprocessSchema(schema);
    
    // 初始化服务基础属性
    this._initializeServiceProperties(schema);
    
    // 创建服务规范
    const serviceSpecification = this._createServiceSpecification();
    
    // 注册服务组件
    this._registerServiceMethods(schema);
    this._registerServiceActions(schema, serviceSpecification);
    this._registerServiceEvents(schema, serviceSpecification);
    
    this._serviceSpecification = serviceSpecification;
    
    // 服务协议解析完成，开始初始化
    
    this._init();
  }

  /**
   * 验证和预处理服务模式
   * @param schema 原始服务模式
   * @returns 处理后的服务模式
   * @throws {ServiceSchemaError} 当模式验证失败时抛出
   * @private
   */
  private _validateAndPreprocessSchema(schema: any): any {
    // 增强错误处理：验证服务模式
    if (!isObject(schema)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '服务模式不能为空或无效',
        {
          expectedType: 'object',
          actualValue: schema,
          suggestions: [
            '请确保传入有效的服务模式对象',
            '检查服务模式是否包含必要的属性（如name、actions等）',
            '参考文档中的服务模式示例'
          ]
        },
        this.logger || undefined
      );
    }

    // 原始协议
    // 优化：使用智能拷贝保存原始模式，并冻结防止意外修改
    this.originalSchema = Object.freeze(CloneOptimizer.smartClone(schema));

    if (schema.mixins) {
      // 服务有引入外部
      schema = this.applyMixins(schema);
    }

    if (isFunction(schema.merged)) {
      schema.merged.call(this, schema);
    } else if (Array.isArray(schema.merged)) {
      schema.merged.forEach((fn) => fn.call(this, schema));
    }

    // 调用服务创建中间件
    this.star.callMiddlewareHookSync('serviceCreating', [this, schema]);

    if (!schema.name) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '服务名称不能为空',
        {
          serviceName: 'unknown',
          schemaProperty: 'name',
          expectedType: 'string',
          actualValue: schema.name,
          suggestions: [
            '在服务模式中添加name属性',
            '确保name属性是非空字符串',
            '检查服务模式的结构是否正确'
          ]
        },
        this.logger || undefined
      );
    }

    return schema;
  }

  /**
   * 初始化服务属性
   * @param schema 服务模式
   * @description 设置服务的基本属性，包括名称、版本、设置、元数据等
   * @private
   */
  private _initializeServiceProperties(schema: any): void {
    this.schema = schema;
    this.name = schema?.name || '';
    this.version = schema?.version || '';
    this.settings = schema?.settings || {};
    this.metadata = schema?.metadata || {};

    this.fullName = Service.getVersionedFullName(
      this.name,
      this.settings?.$noVersionPrefix !== true ? this.version : undefined
    );

    // 引入日志实例
    this.logger = this.star.getLogger(this.fullName, { svc: this.name, version: this.version });

    this.actions = {};
    this.events = {};
  }

  /**
   * 创建服务规范
   * @returns 服务规范对象
   * @description 创建包含服务基本信息的规范对象，用于服务注册
   * @private
   */
  private _createServiceSpecification(): GenericObject {
    return {
      name: this.name,
      version: this.version,
      fullName: this.fullName,
      settings: this._getPublishSettings(this.settings),
      metadata: this.metadata,
      actions: {},
      events: {}
    };
  }

  /**
   * 注册服务方法
   * @param schema 服务模式
   * @description 遍历并注册服务模式中定义的所有方法
   * @throws {ServiceSchemaError} 当方法注册失败时抛出
   * @private
   */
  private _registerServiceMethods(schema: any): void {
    if (!isObject(schema.methods)) return;

    _.forIn(schema.methods, (method, name) => {
      this._validateMethodName(name);
      this._createMethod(method, name);
    });
  }

  /**
   * 验证方法名称是否与系统保留名称冲突
   * @param name 方法名称
   */
  private _validateMethodName(name: string): void {
    const reservedNames = [
      'name', 'version', 'settings', 'metadata', 'dependencies',
      'schema', 'broker', 'star', 'actions', 'logger',
      'created', 'started', 'stopped', '_start', '_stop', '_init', 'applyMixins'
    ];

    if (reservedNames.indexOf(name) !== -1 || name.startsWith('mergeSchema')) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '方法名称与系统保留名称冲突',
        {
          serviceName: this.name,
          schemaProperty: 'methods.' + name,
          actualValue: name,
          suggestions: [
            '使用不同的方法名称',
            '避免使用系统保留的方法名',
            '参考文档中的命名规范'
          ]
        },
        this.logger || undefined
      );
    }
  }

  /**
   * 注册服务动作
   * @param schema 服务模式
   * @param serviceSpecification 服务规范
   * @description 遍历并注册服务模式中定义的所有动作，包括验证和安全检查
   * @throws {ServiceSchemaError} 当动作注册失败时抛出
   * @private
   */
  private _registerServiceActions(schema: any, serviceSpecification: GenericObject): void {
    if (!isObject(schema.actions)) return;

    _.forIn(schema.actions, (action, name) => {
      if (action === false) return;

      // 创建动作模型
      let innerAction = this._createAction(action, name);
      serviceSpecification.actions[innerAction.name] = innerAction;

      const wrappedHandler = this.star.middlewares?.wrapHandler(
        'localAction',
        innerAction.handler,
        innerAction
      ) as Function;

      const ep = this.star.registry?.createPrivateActionEndpoint(innerAction);

      (this.actions as ServiceActions)[name] = (params, options: any) => {
        let ctx: any;

        if (options && options.ctx) {
          ctx = options.ctx;
        } else {
          ctx = this.star.ContextFactory.create(this.star, ep, params, options || {});
        }

        return wrappedHandler(ctx);
      };
    });
  }

  /**
   * 注册服务事件
   * @param schema 服务模式
   * @param serviceSpecification 服务规范
   * @description 遍历并注册服务模式中定义的所有事件，包括验证和安全检查
   * @throws {ServiceSchemaError} 当事件注册失败时抛出
   * @private
   */
  private _registerServiceEvents(schema: any, serviceSpecification: GenericObject): void {
    if (!isObject(schema.events)) return;

    _.forIn(schema.events, (event, name) => {
      // 注册并创建服务中的事件
      const innerEvent = this._createEvent(event, name);
      serviceSpecification.events[innerEvent.name] = innerEvent;

      this.events[innerEvent.name] = (params, options) => {
        let ctx: any;
        if (options && options.ctx) {
          ctx = options.ctx;
        } else {
          const ep = {
            id: this.star.nodeID,
            event: innerEvent
          };
          // 创建上下文
          ctx = this.star.ContextFactory.create(this.star, ep, params, options || {});
        }

        ctx.eventName = name;
        ctx.eventType = 'emit';
        ctx.eventGroups = [innerEvent.group || this.name];

        return innerEvent.handler(ctx);
      };
    });
  }

  /**
   * 引入外部插件
   * @param schema
   * @returns
   */
  public applyMixins(schema: OriginalServiceSchema | Partial<OriginalServiceSchema<ServiceSettingSchema>>) {
    if (schema.mixins) {
      const mixins = Array.isArray(schema.mixins) ? schema.mixins : [schema.mixins];
      if (mixins.length > 0) {
        const mixedSchema = Array.from(mixins)
          .reverse()
          .reduce((s, mixin) => {
            if (mixin.mixins) mixin = this.applyMixins(mixin);

            return s ? this.mergeSchemas(s, mixin) : mixin;
          }, null);

        return this.mergeSchemas(mixedSchema, schema);
      }
    }
  }

  /**
   * 初始化服务
   * @description 执行服务初始化流程，包括调用中间件钩子和created生命周期钩子
   * @returns {Promise<void>} 初始化完成的Promise
   * @throws {Error} 当初始化过程中发生错误时抛出
   * @public
   */
  public _init() {
    this.logger?.debug(`Service '${this.fullName}' is creating...`, {
      serviceName: this.name,
      version: this.version,
      hasCreatedHook: !!(this.schema?.created)
    });

    if (isFunction(this.schema?.created)) {
      // 存在初始化钩子
      this.schema?.created && (this.schema?.created as any).call(this);
    } else if (Array.isArray(this.schema?.created)) {
      // 执行created钩子函数数组
      this.schema?.created.forEach((fn, index) => {
        // 执行created钩子
        fn.call(this);
      });
    }

    // 加载本地服务
    this.star.addLocalService(this as any);

    // 调用中间件
    this.star.callMiddlewareHookSync('serviceCreated', [this]);

    // Service created
  }

  /**
   * 启动服务
   * @description 执行服务启动流程，包括等待依赖服务、调用中间件钩子和started生命周期钩子
   * @returns {Promise<void>} 启动完成的Promise
   * @throws {Error} 当启动过程中发生错误时抛出
   * @public
   */
  public _start() {
    this.logger?.debug(`Service '${this.fullName}' is starting...`, {
      serviceName: this.name,
      version: this.version,
      hasDependencies: !!(this.schema?.dependencies),
      hasStartedHook: !!(this.schema?.started)
    });
    return Promise.resolve()
      .then(() => {
        // 调用中间件
        return this.star.callMiddlewareHook('serviceStarting', [this]);
      })
      .then(() => {
        // 等待依赖的服务
        if (this.schema?.dependencies) {
          this.logger?.debug('开始等待依赖服务', {
            serviceName: this.fullName,
            dependencies: this.schema.dependencies,
            timeout: (this.settings as GenericObject)?.$dependencyTimeout || this.star.options.dependencyTimeout
          });
          return this.waitForServices(
            this.schema.dependencies as string,
            (this.settings as GenericObject)?.$dependencyTimeout || this.star.options.dependencyTimeout,
            (this.settings as GenericObject)?.$dependencyInterval || this.star.options.dependencyInterval
          );
        }
      })
      .then(() => {
        // 执行服务中的start异步方法
        if (isFunction(this.schema?.started)) {
          // 执行started钩子函数
          return promiseMethod(this.schema?.started as any).call(this);
        }

        if (Array.isArray(this.schema?.started)) {
          return this.schema?.started
            .map((fn, index) => {
              if (isFunction(fn)) {
                return promiseMethod(fn.bind(this));
              }
            })
            .reduce((p, fn) => {
              return p.then(() => fn());
            }, Promise.resolve());
        }
      })
      .then(() => {
        // 将服务注册到本地节点中注册表中
        this.logger?.debug('注册服务到本地注册表', {
          serviceName: this.fullName,
          specification: {
            actionsCount: Object.keys(this._serviceSpecification.actions || {}).length,
            eventsCount: Object.keys(this._serviceSpecification.events || {}).length
          }
        });
        return this.star.registerLocalService(this._serviceSpecification as ServiceItem);
      })
      .then(() => {
        // 调用中间件
        return this.star.callMiddlewareHook('serviceStarted', [this]);
      })
      .then(() => {
        this.logger?.info(`Service '${this.fullName}' started.`, {
          serviceName: this.name,
          version: this.version,
          fullName: this.fullName,
          startupComplete: true
        });
      });
  }

  /**
   * 停止服务
   * @description 执行服务停止流程，包括调用中间件钩子、stopped生命周期钩子和资源清理
   * @returns {Promise<void>} 停止完成的Promise
   * @throws {Error} 当停止过程中发生错误时抛出
   * @public
   */
  public async _stop(): Promise<void> {
    this.logger?.info(`Service '${this.fullName}' is stopping...`);

    try {
      // 调用中间件
      await this.star.callMiddlewareHook('serviceStopping', [this], { reverse: true });

      if (isFunction(this.schema?.stopped)) {
        // 执行stopped钩子函数
        await promiseMethod(this.schema?.stopped as any).call(this);
      } else if (this.schema?.stopped && Array.isArray(this.schema?.stopped)) {
        // 执行stopped钩子函数数组
        const arr = Array.from(this.schema.stopped).reverse();

        for (const [index, fn] of arr.entries()) {
          if (fn && isFunction(fn)) {
            await promiseMethod(fn.bind(this))();
          }
        }
      }

      // 调用中间件
      await this.star.callMiddlewareHook('serviceStopped', [this], { reverse: true });

      // 内存管理：清理服务资源
      this._cleanupServiceResources();
      
      this.logger?.info(`Service '${this.fullName}' stopped.`, {
        serviceName: this.name,
        version: this.version,
        fullName: this.fullName,
        shutdownComplete: true
      });
    } catch (error: any) {
       this.logger?.error('服务停止过程中发生错误', {
         serviceName: this.fullName,
         error: error.message,
         stack: error.stack
       });
      
      // 即使出错也要清理资源
      this._cleanupServiceResources();
      
      throw error;
    }
  }

  /**
   * 清理服务资源
   * @description 清理服务相关的所有资源引用，包括动作、事件、服务规范等，优化内存使用
   * @private
   */
  private _cleanupServiceResources(): void {
    this.logger?.debug('开始清理服务资源', {
      serviceName: this.fullName,
      hasActions: !!this.actions,
      hasEvents: !!this.events,
      hasServiceSpec: !!this._serviceSpecification
    });

    try {
      // 清理动作引用
      if (this.actions) {
        Object.keys(this.actions).forEach(actionName => {
          if (this.actions && this.actions[actionName]) {
            delete this.actions[actionName];
          }
        });
        
        this.actions = null;
      }

      // 清理事件引用
      if (this.events) {
        Object.keys(this.events).forEach(eventName => {
          if (this.events && this.events[eventName]) {
            delete this.events[eventName];
          }
        });
        
        this.events = null;
      }

      // 清理服务规范
      if (this._serviceSpecification) {
        // 深度清理服务规范中的引用
        if (this._serviceSpecification.actions) {
          Object.keys(this._serviceSpecification.actions).forEach(key => {
            delete this._serviceSpecification.actions[key];
          });
        }
        
        if (this._serviceSpecification.events) {
          Object.keys(this._serviceSpecification.events).forEach(key => {
            delete this._serviceSpecification.events[key];
          });
        }
        
        if (this._serviceSpecification.methods) {
          Object.keys(this._serviceSpecification.methods).forEach(key => {
            delete this._serviceSpecification.methods[key];
          });
        }
        
        this._serviceSpecification = {};
      }

      // 清理元数据
      if (this.metadata && Object.keys(this.metadata).length > 0) {
        Object.keys(this.metadata).forEach(key => {
          delete this.metadata[key];
        });
      }

      // 清理设置引用（保留基本信息）
      if (this.settings && typeof this.settings === 'object') {
        // 只清理非基本配置的引用
        Object.keys(this.settings).forEach(key => {
          if (key !== 'name' && key !== 'version') {
            delete (this.settings as any)[key];
          }
        });
      }

      // 清理依赖引用
      this.dependencies = null;
      this.originalSchema = null;
    } catch (error) {
      this.logger?.error('清理服务资源时发生错误', {
         serviceName: this.fullName,
         error: (error as Error).message,
         stack: (error as Error).stack
       });
     }
   }

   /**
   * 创建方法
   * 返回的结果:
   * {
   *    name: 'createServer',
   *    service: ${服务},
   *    handler: ${注册的方法}
   * }
   */
  public _createMethod(methodDef: any, name: string) {
    // 解析方法定义
    const method = this._parseMethodDefinition(methodDef, name);
    
    // 验证方法定义
    this._validateMethodDefinition(method, name);
    
    // 配置方法属性
    this._configureMethodProperties(method, name);
    
    return method;
  }

  /**
   * 解析方法定义
   * @param methodDef 方法定义
   * @param name 方法名称
   * @returns 解析后的方法对象
   */
  private _parseMethodDefinition(methodDef: any, name: string): any {
    let method: any;

    if (isFunction(methodDef)) {
      // 如果方法存在
      method = { handler: methodDef };
    } else if (isObject(methodDef)) {
      method = methodDef;
    } else {
      this.logger?.error('方法定义格式无效', {
        serviceName: this.fullName,
        methodName: name,
        expectedType: 'function or object',
        actualType: typeof methodDef,
        actualValue: methodDef
      });
      throw EnhancedErrorHandler.createServiceSchemaError(
        '方法定义格式无效',
        {
          serviceName: this.fullName,
          schemaProperty: 'methods.' + name,
          expectedType: 'function or object',
          actualValue: methodDef,
          suggestions: [
            '方法定义应该是函数或包含handler属性的对象',
            '检查方法定义的语法是否正确',
            '参考文档中的方法定义示例'
          ]
        },
        this.logger || undefined
      );
    }

    return method;
  }

  /**
   * 验证方法定义
   * @param method 方法对象
   * @param name 方法名称
   */
  private _validateMethodDefinition(method: any, name: string): void {
    // 运行时类型验证
    if (!TypeValidator.validateMethodDefinition(method)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '方法定义验证失败',
        {
          serviceName: this.fullName,
          schemaProperty: 'methods.' + name,
          expectedType: 'valid MethodDefinition',
          actualValue: method,
          suggestions: [
            '确保方法定义符合MethodDefinition接口',
            '检查handler属性是否为有效函数',
            '验证其他可选属性的类型'
          ]
        },
        this.logger || undefined
      );
    }
    
    // 边界检查
    if (!BoundaryChecker.checkMethodCount(Object.keys(this.schema?.methods || {}).length + 1)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '方法数量超出限制',
        {
          serviceName: this.fullName,
          schemaProperty: 'methods.' + name,
          expectedType: 'method count within limits',
          actualValue: Object.keys(this.schema?.methods || {}).length + 1,
          suggestions: ['减少方法数量或增加服务拆分']
        },
        this.logger || undefined
      );
    }
    
    // 安全检查
    const securityCheck = SecurityChecker.checkMethodSecurity(name, method);
    if (!securityCheck.isValid) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '方法安全检查失败',
        {
          serviceName: this.fullName,
          schemaProperty: 'methods.' + name,
          expectedType: 'secure method definition',
          actualValue: method,
          suggestions: securityCheck.errors
        },
        this.logger || undefined
      );
    }

    // 验证处理器
    if (!isFunction(method.handler)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '方法处理器缺失或无效',
        {
          serviceName: this.fullName,
          schemaProperty: 'methods.' + name + '.handler',
          expectedType: 'function',
          actualValue: method.handler,
          suggestions: [
            '确保方法定义包含有效的handler函数',
            '检查handler属性是否正确设置',
            '验证函数定义的语法'
          ]
        },
        this.logger || undefined
      );
    }
  }

  /**
   * 配置方法属性
   * @param method 方法对象
   * @param name 方法名称
   */
  private _configureMethodProperties(method: any, name: string): void {
    method.name = name;
    method.service = this;
    method.handler = method.handler.bind(this);
    this[name] = this.star.middlewares?.wrapHandler('localMethod', method.handler, method);
  }

  /**
   * 创建动作
   * 返回的结果:
   * {
   *    name: 'createServer',
   *    service: ${服务},
   *    handler: ${注册的动作}
   * }
   */
  /**
   * 创建动作
   * @param actionDef 动作定义，可以是函数或包含handler的对象
   * @param name 动作名称
   * @returns 创建的动作对象
   * @description 解析、验证并配置服务动作，包括运行时类型验证、边界检查和安全验证
   * @throws {ServiceSchemaError} 当动作创建失败时抛出
   * @public
   */
  public _createAction(actionDef: any, name: string) {
    // 解析动作定义
    const action = this._parseActionDefinition(actionDef, name);
    
    // 验证动作定义
    this._validateActionDefinition(action, name);
    
    // 配置动作属性
    this._configureActionProperties(action, name);
    
    return action;
  }

  /**
   * 解析动作定义
   * @param actionDef 动作定义
   * @param name 动作名称
   * @returns 解析后的动作对象
   */
  private _parseActionDefinition(actionDef: any, name: string): GenericObject {
    let action: GenericObject;

    if (isFunction(actionDef)) {
      action = { handler: actionDef };
    } else if (isObject(actionDef)) {
      // 优化：使用结构化拷贝，保留 handler 函数引用，提升性能
      action = CloneOptimizer.structuredClone(actionDef, true);
    } else {
      this.logger?.error('动作定义格式无效', {
        serviceName: this.fullName,
        actionName: name,
        expectedType: 'function or object',
        actualType: typeof actionDef,
        actualValue: actionDef
      });
      throw EnhancedErrorHandler.createServiceSchemaError(
        '动作定义格式无效',
        {
          serviceName: this.fullName,
          schemaProperty: 'actions.' + name,
          expectedType: 'function or object',
          actualValue: actionDef,
          suggestions: [
            '动作定义应该是函数或包含handler属性的对象',
            '检查动作定义的语法是否正确',
            '参考文档中的动作定义示例'
          ]
        },
        this.logger || undefined
      );
    }

    return action;
  }

  /**
   * 验证动作定义
   * @param action 动作对象
   * @param name 动作名称
   */
  private _validateActionDefinition(action: GenericObject, name: string): void {
    // 运行时类型验证
    if (!TypeValidator.validateActionDefinition(action)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '动作定义验证失败',
        {
          serviceName: this.fullName,
          schemaProperty: 'actions.' + name,
          expectedType: 'valid ActionDefinition',
          actualValue: action,
          suggestions: [
            '确保动作定义符合ActionDefinition接口',
            '检查handler属性是否为有效函数',
            '验证visibility等可选属性的值'
          ]
        },
        this.logger || undefined
      );
    }
    
    // 边界检查
    if (!BoundaryChecker.checkActionCount(Object.keys(this.schema?.actions || {}).length + 1)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '动作数量超出限制',
        {
          serviceName: this.fullName,
          schemaProperty: 'actions.' + name,
          expectedType: 'action count within limits',
          actualValue: Object.keys(this.schema?.actions || {}).length + 1,
          suggestions: ['减少动作数量或增加服务拆分']
        },
        this.logger || undefined
      );
    }
    
    // 安全检查
    const securityCheck = SecurityChecker.checkActionSecurity(name, action);
    if (!securityCheck.isValid) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '动作安全检查失败',
        {
          serviceName: this.fullName,
          schemaProperty: 'actions.' + name,
          expectedType: 'secure action definition',
          actualValue: action,
          suggestions: securityCheck.errors
        },
        this.logger || undefined
      );
    }

    // 验证处理器函数
    if (!isFunction(action.handler)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '动作处理器缺失或无效',
        {
          serviceName: this.fullName,
          schemaProperty: 'actions.' + name + '.handler',
          expectedType: 'function',
          actualValue: action.handler,
          suggestions: [
            '确保动作定义包含有效的handler函数',
            '检查handler属性是否正确设置',
            '验证函数定义的语法'
          ]
        },
        this.logger || undefined
      );
    }
  }

  /**
   * 配置动作属性
   * @param action 动作对象
   * @param name 动作名称
   */
  private _configureActionProperties(action: GenericObject, name: string): void {
    action.rawName = action.name || name;
    
    // 设置动作名称
    if (this.settings?.$noServiceNamePrefix !== true) {
      action.name = this.fullName + '.' + action.rawName;
    } else {
      action.name = action.rawName;
    }

    // 设置缓存配置
    if (action.cache === undefined && this.settings?.$cache !== undefined) {
      action.cache = this.settings?.$cache;
    }

    // 设置服务引用和处理器
    action.service = this;
    action.handler = promiseMethod(action.handler.bind(this));
  }

  /**
   * 创建事件
   * {
   *    name: 'createServer',
   *    service: ${服务},
   *    handler: ${注册的事件}
   * }
   */
  /**
   * 创建事件
   * @param eventDef 事件定义，可以是函数、数组或包含handler的对象
   * @param name 事件名称
   * @returns 创建的事件对象
   * @description 解析、验证并配置服务事件，包括运行时类型验证、边界检查和安全验证
   * @throws {ServiceSchemaError} 当事件创建失败时抛出
   * @public
   */
  public _createEvent(eventDef: any, name: string) {
    // 解析事件定义
    const event = this._parseEventDefinition(eventDef, name);
    
    // 验证事件定义
    this._validateEventDefinition(event, name);
    
    // 处理事件处理器
    const handler = this._processEventHandler(event);
    
    // 配置事件属性
    this._configureEventProperties(event, name, handler);
    
    return event;
  }

  /**
   * 解析事件定义
   * @param eventDef 事件定义
   * @param name 事件名称
   * @returns 解析后的事件对象
   */
  private _parseEventDefinition(eventDef: any, name: string): GenericObject {
    this.logger?.debug('开始解析事件定义', {
      serviceName: this.fullName,
      eventName: name,
      eventType: typeof eventDef,
      isFunction: isFunction(eventDef),
      isArray: Array.isArray(eventDef),
      isObject: isObject(eventDef)
    });

    let event: GenericObject;

    if (isFunction(eventDef) || Array.isArray(eventDef)) {
      this.logger?.debug('事件定义为函数或数组类型', {
        serviceName: this.fullName,
        eventName: name,
        isFunction: isFunction(eventDef),
        isArray: Array.isArray(eventDef),
        arrayLength: Array.isArray(eventDef) ? eventDef.length : undefined
      });
      event = {
        handler: eventDef
      };
    } else if (isObject(eventDef)) {
      this.logger?.debug('事件定义为对象类型，进行结构化拷贝', {
        serviceName: this.fullName,
        eventName: name,
        objectKeys: Object.keys(eventDef)
      });
      // 优化：使用结构化拷贝，保留 handler 函数引用
      event = CloneOptimizer.structuredClone(eventDef, true);
    } else {
      this.logger?.error('事件定义格式无效', {
        serviceName: this.fullName,
        eventName: name,
        expectedType: 'function, array, or object',
        actualType: typeof eventDef,
        actualValue: eventDef
      });
      throw EnhancedErrorHandler.createServiceSchemaError(
        '事件定义格式无效',
        {
          serviceName: this.fullName,
          schemaProperty: 'events.' + name,
          expectedType: 'function, array, or object',
          actualValue: eventDef,
          suggestions: [
            '事件定义应该是函数、函数数组或包含handler属性的对象',
            '检查事件定义的语法是否正确',
            '参考文档中的事件定义示例'
          ]
        },
        this.logger || undefined
      );
    }

    this.logger?.debug('事件定义解析完成', {
      serviceName: this.fullName,
      eventName: name,
      hasHandler: !!event.handler
    });

    return event;
  }

  /**
   * 验证事件定义
   * @param event 事件对象
   * @param name 事件名称
   */
  private _validateEventDefinition(event: GenericObject, name: string): void {
    // 运行时类型验证
    if (!TypeValidator.validateEventDefinition(event)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '事件定义验证失败',
        {
          serviceName: this.fullName,
          schemaProperty: 'events.' + name,
          expectedType: 'valid EventDefinition',
          actualValue: event,
          suggestions: [
            '确保事件定义符合EventDefinition接口',
            '检查handler属性是否为有效函数或函数数组',
            '验证group等可选属性的类型'
          ]
        },
        this.logger || undefined
      );
    }
    
    // 边界检查
    if (!BoundaryChecker.checkEventCount(Object.keys(this.schema?.events || {}).length + 1)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '事件数量超出限制',
        {
          serviceName: this.fullName,
          schemaProperty: 'events.' + name,
          expectedType: 'event count within limits',
          actualValue: Object.keys(this.schema?.events || {}).length + 1,
          suggestions: ['减少事件数量或增加服务拆分']
        },
        this.logger || undefined
      );
    }
    
    // 安全检查
    const securityCheck = SecurityChecker.checkEventSecurity(name, event);
    if (!securityCheck.isValid) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '事件安全检查失败',
        {
          serviceName: this.fullName,
          schemaProperty: 'events.' + name,
          expectedType: 'secure event definition',
          actualValue: event,
          suggestions: securityCheck.errors
        },
        this.logger || undefined
      );
    }

    // 验证处理器
    if (!isFunction(event.handler) && !Array.isArray(event.handler)) {
      throw EnhancedErrorHandler.createServiceSchemaError(
        '事件处理器缺失或无效',
        {
          serviceName: this.fullName,
          schemaProperty: 'events.' + name + '.handler',
          expectedType: 'function or array',
          actualValue: event.handler,
          suggestions: [
            '确保事件定义包含有效的handler函数或函数数组',
            '检查handler属性是否正确设置',
            '验证函数定义的语法'
          ]
        },
        this.logger || undefined
      );
    }
  }

  /**
   * 处理事件处理器
   * @param event 事件对象
   * @returns 处理后的处理器
   */
  private _processEventHandler(event: GenericObject): any {
    this.logger?.debug('开始处理事件处理器', {
      serviceName: this.fullName,
      eventName: event.name,
      handlerType: typeof event.handler,
      isFunction: isFunction(event.handler),
      isArray: Array.isArray(event.handler)
    });

    let handler: any;

    if (isFunction(event.handler)) {
      // 获得参数
      const args = functionArguments(event.handler);
      handler = promiseMethod(event.handler);
      handler.__newSignature = event.context === true || isNewSignature(args);
    } else if (Array.isArray(event.handler)) {
      handler = event.handler.map((h, index) => {
        this.logger?.debug(`处理第${index + 1}个处理器`, {
          serviceName: this.fullName,
          eventName: event.name,
          handlerIndex: index,
          handlerType: typeof h
        });
        
        const args = functionArguments(h);
        h = promiseMethod(h);
        h.__newSignature = event.context === true || isNewSignature(args);
        return h;
      });
      
      this.logger?.debug('数组处理器处理完成', {
        serviceName: this.fullName,
        eventName: event.name,
        processedCount: handler.length
      });
    }

    this.logger?.debug('事件处理器处理完成', {
      serviceName: this.fullName,
      eventName: event.name,
      handlerProcessed: !!handler
    });

    return handler;
  }

  /**
   * 配置事件属性
   * @param event 事件对象
   * @param name 事件名称
   * @param handler 处理器
   */
  private _configureEventProperties(event: GenericObject, name: string, handler: any): void {
    if (!event.name) event.name = name;
    event.service = this;
    
    const self = this;

    if (isFunction(handler)) {
      event.handler = function (ctx) {
        return handler.apply(self, handler.__newSignature ? [ctx] : [ctx.params, ctx.nodeID, ctx.eventName, ctx]);
      };
    } else if (Array.isArray(handler)) {
      event.handler = function (ctx) {
        return Promise.all(
          handler.map((fn) => fn.apply(self, fn.__newSignature ? [ctx] : [ctx.params, ctx.nodeID, ctx.eventName, ctx]))
        );
      };
    }
  }

  /**
   * 返回一个服务的数据（不包括服务私有的属性）
   */
  public _getPublishSettings(settings?: GenericObject) {
    if (settings && Array.isArray(settings.$secureSettings)) {
      return _.omit(settings, ([] as any[]).concat(settings.$secureSettings as any[], ['$secureSettings']));
    }

    return settings;
  }

  /**
   * 合并服务协议
   */
  @performanceMonitor(3) // 监控超过3ms的操作
  public mergeSchemas(mixinSchema: any, serviceSchema: any) {
    // 优化：提前返回，避免不必要的拷贝操作
    if (!mixinSchema && !serviceSchema) return {};
    if (!serviceSchema) return CloneOptimizer.smartClone(mixinSchema);
    if (!mixinSchema) return CloneOptimizer.smartClone(serviceSchema);
    
    // 优化：使用智能拷贝，根据对象复杂度选择拷贝策略
    const res = CloneOptimizer.smartClone(mixinSchema);
    const mods = CloneOptimizer.smartClone(serviceSchema);

    Object.keys(mods).forEach((key) => {
      if ((key === 'name' || key === 'version') && mods[key] !== undefined) {
        res[key] = mods[key];
      } else if (key === 'settings') {
        res[key] = this.mergeSchemaSettings(mods[key], res[key]);
      } else if (key === 'metadata') {
        res[key] = this.mergeSchemaMetadata(mods[key], res[key]);
      } else if (key === 'hooks') {
        res[key] = this.mergeSchemaHooks(mods[key], res[key] || {});
      } else if (key === 'actions') {
        res[key] = this.mergeSchemaActions(mods[key], res[key] || {});
      } else if (key === 'methods') {
        res[key] = this.mergeSchemaMethods(mods[key], res[key]);
      } else if (key === 'events') {
        res[key] = this.mergeSchemaEvents(mods[key], res[key] || {});
      } else if (['merged', 'created', 'started', 'stopped'].indexOf(key) !== -1) {
        res[key] = this.mergeSchemaLifecycleHandlers(mods[key], res[key]);
      } else if (key === 'mixins') {
        res[key] = this.mergeSchemaUniqArray(mods[key], res[key]);
      } else if (key === 'dependencies') {
        res[key] = this.mergeSchemaDependencies(mods[key], res[key]);
      } else {
        const customFnName = 'mergeSchema' + key.replace(/./, key[0].toUpperCase());

        if (isFunction(this[customFnName])) {
          res[key] = this[customFnName](mods[key], res[key]);
        } else {
          res[key] = this.mergeSchemaUnkown(mods[key], res[key]);
        }
      }
    });

    return res;
  }

  /**
   * 合并服务协议的settings属性
   */
  public mergeSchemaSettings(src: GenericObject, target: GenericObject) {
    if ((target && target.$secureSettings) || (src && src.$secureSettings)) {
      const srcSS = src && src.$secureSettings ? src.$secureSettings : [];
      const targetSS = target && target.$secureSettings ? target.$secureSettings : [];
      if (!target) target = {};
      target.$secureSettings = _.uniq([].concat(srcSS, targetSS));
    }

    return _.defaultsDeep(src, target);
  }

  /**
   * 合并服务协议中的metadata属性
   */
  public mergeSchemaMetadata(src: GenericObject, target: GenericObject) {
    return _.defaultsDeep(src, target);
  }

  /**
   * 合并服务协议中的mixins属性
   */
  public mergeSchemaUniqArray(src: GenericObject, target: GenericObject) {
    return _.uniqWith(_.compact(flatten([src, target])), _.isEqual);
  }

  /**
   * 合并服务协议中的dependencies属性
   */
  public mergeSchemaDependencies(src: GenericObject, target: GenericObject) {
    return this.mergeSchemaUniqArray(src, target);
  }

  /**
   * 合并服务协议中的hooks属性
   */
  public mergeSchemaHooks(src: GenericObject, target: GenericObject) {
    Object.keys(src).forEach((key) => {
      if (target[key] == null) target[key] = {};

      Object.keys(src[key]).forEach((childKey) => {
        const modHook = wrapToArray(src[key][childKey]);
        const resHook = wrapToArray(target[key][childKey]);
        target[key][childKey] = _.compact(flatten(key === 'before' ? [resHook, modHook] : [modHook, resHook]));
      });
    });

    return target;
  }

  /**
   * 合并服务协议中的动作
   */
  public mergeSchemaActions(src: GenericObject, target: GenericObject) {
    Object.keys(src).forEach((key) => {
      if (src[key] === false && target[key]) {
        delete target[key];
        return;
      }
      const srcAction = wrapToHandler(src[key]);
      const targetAction = wrapToHandler(target[key]);
      if (srcAction && srcAction.hooks && targetAction && targetAction.hooks) {
        Object.keys(srcAction.hooks).forEach((childKey) => {
          const modHook = wrapToArray(srcAction.hooks[childKey]);
          const resHook = wrapToArray(targetAction.hooks[childKey]);
          srcAction.hooks[childKey] = _.compact(
            flatten(childKey === 'before' ? [resHook, modHook] : [modHook, resHook])
          );
        });
      }

      target[key] = _.defaultsDeep(srcAction, targetAction);
    });

    return target;
  }

  /**
   * 合并服务协议中的Method属性
   */
  public mergeSchemaMethods(src: GenericObject, target: GenericObject) {
    return Object.assign(target || {}, src || {});
  }

  /**
   * 合并服务协议中的events属性
   */
  public mergeSchemaEvents(src: GenericObject, target: GenericObject) {
    Object.keys(src).forEach((key) => {
      const modEvent = wrapToHandler(src[key]);
      const resEvent = wrapToHandler(target[key]);
      let handler = _.compact(flatten([resEvent ? resEvent.handler : null, modEvent ? modEvent.handler : null]));
      if (handler.length === 1) handler = handler[0];
      target[key] = _.defaultsDeep(modEvent, resEvent);
      target[key].handler = handler;

      return target;
    });
  }

  /**
   * 合并服务协议中的stared、stopped、created、事件处理器等属性
   */
  public mergeSchemaLifecycleHandlers(src: GenericObject, target: GenericObject) {
    return _.compact(flatten([target, src]));
  }

  /**
   * 合并服务协议中的未知的属性
   */
  public mergeSchemaUnkown(src: GenericObject, target: GenericObject) {
    if (src !== undefined) return src;

    return target;
  }

  /**
   * 等待其他的服务
   */
  public waitForServices(serviceNames: string | string[], timeout: number, interval: number) {
    return this.star.waitForServices(serviceNames, timeout, interval, this.logger);
  }

  /**
   * 触发本地节点事件处理方法，一般用作测试
   */
  public emitLocalEventHandler(eventName: string, params?: any, options?: GenericObject) {
    if (!this.events[eventName]) {
      return Promise.reject(
        new UniverseError(
          `No '${eventName}' registered local event handler`,
          UniverseErrorCode.SERVICE_ERROR,
          UniverseErrorOptionsType.NOT_FOUND_EVENT,
          { eventName }
        )
      );
    }

    return this.events[eventName](params, options);
  }
}
