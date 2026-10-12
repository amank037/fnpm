"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

function expandEnv(value) {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || "");
}

function parseNpmrc(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = expandEnv(value);
  }
  return out;
}

function loadConfig(projectDir) {
  const userConfig =
    process.env.NPM_CONFIG_USERCONFIG || path.join(os.homedir(), ".npmrc");
  const merged = {
    ...parseNpmrc(userConfig),
    ...parseNpmrc(path.join(projectDir, ".npmrc")),
  };
  for (const [key, value] of Object.entries(process.env)) {
    const match = /^npm_config_(.+)$/i.exec(key);
    if (match && value) {
      merged[match[1].toLowerCase().replace(/_/g, "-")] = value;
    }
  }
  return merged;
}

function registryFor(name, config) {
  const scope = name.startsWith("@") ? name.split("/")[0] : null;
  const configured =
    (scope && config[`${scope}:registry`]) ||
    config.registry ||
    DEFAULT_REGISTRY;
  return configured.endsWith("/") ? configured : `${configured}/`;
}

function mapResolvedUrl(resolved, name, config) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return resolved;
  }
  if (url.hostname !== "registry.npmjs.org") return resolved;
  let registry;
  try {
    registry = new URL(registryFor(name, config));
  } catch {
    return resolved;
  }
  if (registry.host === url.host) return resolved;
  const basePath = registry.pathname.replace(/\/+$/, "");
  return `${registry.protocol}//${registry.host}${basePath}${url.pathname}${url.search}`;
}

function authHeaderFor(rawUrl, config) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let dir = url.pathname.replace(/[^/]*$/, "");
  for (;;) {
    const prefix = `//${url.host}${dir}`;
    const token = config[`${prefix}:_authToken`];
    if (token) return `Bearer ${token}`;
    const basic = config[`${prefix}:_auth`];
    if (basic) return `Basic ${basic}`;
    const username = config[`${prefix}:username`];
    const password = config[`${prefix}:_password`];
    if (username && password) {
      const decoded = Buffer.from(password, "base64").toString("utf8");
      return `Basic ${Buffer.from(`${username}:${decoded}`).toString("base64")}`;
    }
    if (dir === "/" || dir === "") break;
    dir = dir.replace(/[^/]+\/$/, "");
  }
  return null;
}

module.exports = { loadConfig, mapResolvedUrl, authHeaderFor, registryFor };
