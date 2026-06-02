import { isFunction, isString } from '@/utils';
import Context from '../context';
import { METRIC } from '../metrics';
import Star from '../star';
import { UniverseError } from '../error';

export default function FallbackMiddleware(star: Star) {
  function handleContextFallback(ctx: Context, err: Error) {
    star.logger?.warn(`The '${ctx.action?.name}' request is failed. Return fallback response.`, {
      requestID: ctx.requestID,
      err: err.message
    });
    star.metrics?.increment(METRIC.UNIVERSE_REQUEST_FALLBACK_TOTAL, {
      action: ctx.action?.name || 'unknown'
    });
    (ctx as any).fallbackResult = true;

    if (isFunction(ctx.options.fallbackResponse)) {
      return (ctx.options.fallbackResponse as Function)(ctx, err);
    } else {
      return Promise.resolve(ctx.options.fallbackResponse);
    }
  }

  const wrapFallbackMiddleware = (handler: any, action: any) => {
    const FallbackMiddleware = (ctx: Context) => {
      return handler(ctx).catch((err) => {
        if (ctx.options.fallbackResponse) {
          return handleContextFallback(ctx, err);
        }

        if (action.fallback && action.service) {
          const svc = action.service;
          const fallback = isString(action.fallback) ? svc[action.fallback] : action.fallback;

          if (!isFunction(fallback)) {
            throw new UniverseError(
              `The 'fallback' of '${action.name}' action is not a Function or valid method name: ${action.fallback}`
            );
          }

          svc.logger.warn(`The '${ctx.action?.name}' request is failed. Return fallback response.`, {
            requestID: ctx.requestID,
            err: err.message
          });

          star.metrics?.increment(METRIC.UNIVERSE_REQUEST_FALLBACK_TOTAL, {
            service: svc.fullName,
            action: action.name
          });

          (ctx as any).fallbackResult = true;

          return fallback.call(svc, ctx, err);
        }

        return Promise.reject(err);
      });
    };

    return FallbackMiddleware.bind(star);
  };

  return {
    name: 'Fallback',

    created(star: Star) {
      if (star.isMetricsEnabled()) {
        star.metrics?.register({
          name: METRIC.UNIVERSE_REQUEST_FALLBACK_TOTAL,
          type: METRIC.TYPE_COUNTER,
          labelNames: ['service', 'action'],
          description: '请求失败后成功执行回退逻辑的总次数',
          rate: true
        });
      }
    },

    localAction: wrapFallbackMiddleware,
    remoteAction: wrapFallbackMiddleware
  };
}
