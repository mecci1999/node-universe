import _ from 'lodash';
import kleur from 'kleur';
import BaseDiscoverer from './base';
import Serializer from '@/lib/serializers';
import C from '../../star/constants';
import { removeFromArray } from '@/utils';
import { DiscovererOptions } from '@/typings/registry/discoverers';
import { Etcd3 } from 'etcd3';
import { Registry } from '..';

export default class Etcd3Discoverer extends BaseDiscoverer {
  private index: number;
  private client: Etcd3 | null = null;
  private lastInfoSeq: number;
  private lastBeatSeq: number;
  private leaseBeat: any;
  private leaseInfo: any;

  constructor(options: DiscovererOptions) {
    if (typeof options === 'string') options = { etcd: { hosts: (options as string).replace(/etcd3:\/\//g, '') } };

    super(options);

    this.options = _.defaultsDeep(this.options, {
      ectd: undefined,
      serializer: 'JSON',
      fullCheck: 10
    });

    this.index = this.options.fullCheck > 1 ? _.random(this.options.fullCheck - 1) : 0;
    this.client = null;

    // Last sequence numbers
    this.lastInfoSeq = 0;
    this.lastBeatSeq = 0;

    // Leases
    this.leaseBeat = null;
    this.leaseInfo = null;
  }

  public init(registry: Registry): void {
    super.init(registry);

    if (!Etcd3) {
      this.star?.fatal(
        `The 'etcd3' package is missing. Please install it with 'npm install etcd3 --save' command.`,
        null,
        true
      );
    }

    this.logger?.warn(kleur.yellow().bold('Etcd3 Discoverer is an experimental module. DO NOT use it in production!'));

    this.client = new Etcd3(this.options.etcd);
  }

  public stop(): Promise<void> {
    this.client?.close();
    this.client = null;
    return super.stop();
  }
}
