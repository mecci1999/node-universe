import { sleep } from '@/utils';
import Context from '../context';
import { METRIC } from '../metrics';
import Star from '../star';
import { ServiceActions } from '@/typings/star/service';

const retryMiddleware = (star: Star) => {
  const wrapRetryMiddleware = (handler: any, action: any) => {
    const actionName = action.name;
    const service = action.service ? action.service.fullName : null;

    const options = Object.assign({}, star.options.retryPolicy, action.retryPolicy || {});
    if (options.enabled) {
      return function RetryMiddleware(ctx: Context) {
        const attempts = typeof ctx.options.retries === 'number' ? ctx.options.retries : options.retries;

        if ((ctx as any)._retryAttempts == null) (ctx as any)._retryAttempts = 0;

        return handler(ctx).catch((err) => {
          if (ctx.nodeID != star.nodeID && ctx.endpoint?.local) {
            return Promise.reject(err);
          }

          if (options.check(err)) {
            star.metrics?.increment(METRIC.UNIVERSE_REQUEST_RETRY_ATTEMPTS_TOTAL, { service, action: action.name });

            if ((ctx as any)._retryAttempts < attempts) {
              (ctx as any)._retryAttempts++;
            }

            if (ctx.span) {
              ctx.span.setError(err);
              ctx.span.addTags({ retryAttempts: (ctx as any)._retryAttempts });
              ctx.finishSpan(ctx.span);
            }

            const delay = Math.min(
              options.delay * Math.pow(options.factor, (ctx as any)._retryAttempts - 1),
              options.maxDelay
            );

            star.logger?.warn(`Retry to call '${actionName}' action after ${delay} ms...`, {
              requestID: ctx.requestID,
              attempts: (ctx as any)._retryAttempts
            });

            return sleep(delay).then(() => {
              const newCtx = ctx.copy();
              (newCtx as any)._retryAttempts = (ctx as any)._retryAttempts;

              if (action.visibility == 'private') {
                return (ctx.service?.actions as ServiceActions)[action.rawName](ctx.params, { ctx: newCtx });
              }

              return star.call(actionName, ctx.params, { ctx: newCtx });
            });
          }

          return Promise.reject(err);
        });
      };
    }

    return handler;
  };

  return {
    name: 'Retry',
    created() {
      if (star.isMetricsEnabled()) {
        star.metrics?.register({
          name: METRIC.UNIVERSE_REQUEST_RETRY_ATTEMPTS_TOTAL,
          type: METRIC.TYPE_COUNTER,
          labelNames: ['service', 'action'],
          description: '触发重试策略的动作调用总次数',
          rate: true
        });
      }
    },

    localAction: wrapRetryMiddleware,
    remoteAction: wrapRetryMiddleware
  };
};

export default retryMiddleware;
