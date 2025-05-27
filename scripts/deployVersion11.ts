import { toNano } from '@ton/core';
import { Version11 } from '../wrappers/Version11';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const version11 = provider.open(Version11.createFromConfig({}, await compile('Version11')));

    await version11.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(version11.address);

    // run methods on `version11`
}
