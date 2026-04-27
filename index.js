/**
 * @format
 */

// Polyfill Node globals used by binary protocol code (FrameCodec, ProtocolCodec)
// and react-native-tcp-socket. Must run before any module that references Buffer.
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
