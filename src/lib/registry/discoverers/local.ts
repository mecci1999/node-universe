import { DiscovererOptions } from '@/typings/registry/discoverers';
import BaseDiscoverer from './base';
import { Registry } from '..';

export default class LocalDiscoverer extends BaseDiscoverer {
  constructor(options?: DiscovererOptions) {
    super(options);
  }

  public init(registry: Registry): void {
    super.init(registry);
  }

  /**
   * 发现节点
   * @param nodeID
   * @returns
   */
  public discoverNode(nodeID?: string | undefined) {
    if (!this.transit || !nodeID) return Promise.resolve();

    return this.transit.discoverNode(nodeID);
  }

  /**
   * 发现所有的节点
   * @returns
   */
  public discoverAllNodes() {
    if (!this.transit) return Promise.resolve();

    return this.transit.discoverNodes();
  }

  /**
   * 发送本地节点信息
   */
  public sendLocalNodeInfo(nodeID?: string): Promise<void> {
    if (!this.transit) return Promise.resolve();

    // 获取自身节点的数据
    const info = this.star?.getLocalNodeInfo();
    if (!info) return Promise.resolve();

    const p =
      !nodeID && this.star?.options.disableBalancer
        ? this.transit.transporter.makeBalancedSubscriptions()
        : Promise.resolve();

    // 发送给对应的节点
    return p.then(() => this.transit?.sendNodeInfo(info, nodeID || ''));
  }
}
