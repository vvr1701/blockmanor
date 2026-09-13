// Monorepo Metro config (PRD §4.2): watch the workspace root so
// @blockmanor/shared resolves from source, and resolve modules from both
// the app and the hoisted root node_modules.
//
// `resolver.disableHierarchicalLookup` is left at Expo's default (false):
// expo-doctor flags forcing it on, and with `node-linker=hoisted` there is a
// single React copy either way — verified by counting react/react-native
// package roots in an exported Android source map before and after removing it.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
