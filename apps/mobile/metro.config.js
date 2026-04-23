const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

module.exports = getDefaultConfig(__dirname);
// Find the project and workspace root
const projectRoot = __dirname;
// This can be replaced with `find-up` or a similar library if the monorepo structure changes
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force Metro to resolve (order is important)
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
