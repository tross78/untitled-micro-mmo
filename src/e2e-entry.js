import { installFakeTransport } from './e2e/fake-transport.js';
import { useFakeTransport } from '../infra/runtime.js';

if (useFakeTransport()) installFakeTransport();

import('./main.js');
