import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { anvilChain } from './contracts';

export const wagmiConfig = getDefaultConfig({
  appName: 'Secure Vote',
  projectId: 'YOUR_PROJECT_ID', // Not needed for local testing
  chains: [anvilChain as any],
  ssr: false,
});
