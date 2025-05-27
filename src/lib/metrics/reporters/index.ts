import { StarOptionsError } from '@/lib/error';
import { isObject, isString, isInheritedClass } from '@/utils';
import BaseReporter from './base';
import PrometheusReporter from './prometheus';
import ConsoleReporter from './console';
import EventRepoter from './event';
import CSVReporter from './csv';
import DataDogReporter from './datadog';
import StatsdReporter from './statsd';

const Reporters = {
  Base: BaseReporter,
  Console: ConsoleReporter,
  Event: EventRepoter,
  CSV: CSVReporter,
  Prometheus: PrometheusReporter,
  DateDog: DataDogReporter,
  Statsd: StatsdReporter
};

function getByName(name) {
  /* istanbul ignore next */
  if (!name) return null;

  let n = Object.keys(Reporters).find((n) => n.toLowerCase() == name.toLowerCase());
  if (n) return Reporters[n];
}

/**
 * Resolve reporter by name
 *
 * @param {object|string} opt
 * @returns {Reporter}
 * @memberof ServiceBroker
 */
function resolve(opt) {
  if (isObject(opt) && isInheritedClass(opt, Reporters.Base)) {
    return opt;
  } else if (isString(opt)) {
    let ReporterClass = getByName(opt);
    if (ReporterClass) return new ReporterClass();
  } else if (isObject(opt)) {
    let ReporterClass = getByName(opt.type);
    if (ReporterClass) return new ReporterClass(opt.options);
    else
      throw new StarOptionsError(`Invalid metric reporter type '${opt.type}'.`, {
        type: opt.type
      });
  }

  throw new StarOptionsError(`Invalid metric reporter type '${opt}'.`, { type: opt });
}

function register(name, value) {
  Reporters[name] = value;
}

export default Object.assign(Reporters, { resolve, register });
