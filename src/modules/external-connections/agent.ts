import { PacProxyAgent } from 'pac-proxy-agent';

import hyperProxy from './hyper.js';
import { I2P_PROXY, TOR_PROXY } from '../../env.js';

function buildPacURI() {
	const I2pConfig = I2P_PROXY
		? `
if (shExpMatch(host, "*.i2p"))
{
  return "SOCKS5 ${I2P_PROXY}";
}`.trim()
		: '';
	const TorConfig = TOR_PROXY
		? `
if (shExpMatch(host, "*.onion"))
{
  return "SOCKS5 ${TOR_PROXY}";
}`.trim()
		: '';

	const HyperConfig = hyperProxy.running
		? `
if (shExpMatch(host, "*.hyper"))
{
  return "SOCKS5 ${hyperProxy.address}";
}`.trim()
		: '';

	const PACFile = `
// SPDX-License-Identifier: CC0-1.0

function FindProxyForURL(url, host)
{
  ${I2pConfig}
  ${TorConfig}
  ${HyperConfig}
  return "DIRECT";
}
`.trim();

	return 'pac+data:application/x-ns-proxy-autoconfig;base64,' + btoa(PACFile);
}

export const agent = new PacProxyAgent(buildPacURI(), { fallbackToDirect: true });

export async function updateAgent(uri = buildPacURI()) {
	// copied from https://github.com/TooTallNate/proxy-agents/blob/main/packages/pac-proxy-agent/src/index.ts#L79C22-L79C51
	agent.uri = new URL(uri.replace(/^pac\+/i, ''));

	// forces the agent to refetch the resolver and pac file
	agent.resolverPromise = undefined;
}

// refresh the agent when the hyper proxy starts or stops
hyperProxy.on('started', () => updateAgent());
hyperProxy.on('stopped', () => updateAgent());
