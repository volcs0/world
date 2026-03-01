#!/usr/bin/env node
// Converts the original plist data files from the "World of Where" app bundle
// into optimised JSON files used by the web app.
// Run once from the project root: node scripts/process-data.js

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES = join(__dirname, '../old/Contents/Resources');
const OUTPUT = join(__dirname, '../static/data');

mkdirSync(OUTPUT, { recursive: true });

function readPlist(filename) {
  const json = execSync(
    `plutil -convert json -o - "${join(RESOURCES, filename)}"`,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(json);
}

// Compute centroid + bounding box from SVG path M commands
function labelInfo(pathStrings) {
  const xs = [], ys = [];
  const re = /M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  for (const p of pathStrings) {
    let m;
    while ((m = re.exec(p)) !== null) {
      xs.push(parseFloat(m[1]));
      ys.push(parseFloat(m[2]));
    }
  }
  if (!xs.length) return null;
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const lw = Math.max(55, Math.min(260, Math.min(w, h) * 0.22));
  return { cx: Math.round(cx), cy: Math.round(cy), lw: Math.round(lw) };
}

// Extract min/max coords from SVG path strings (approximation via M commands)
function pathBounds(pathStrings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const re = /M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  for (const p of pathStrings) {
    let m;
    while ((m = re.exec(p)) !== null) {
      const x = parseFloat(m[1]), y = parseFloat(m[2]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

// ── 1. Geometry ────────────────────────────────────────────────────────────

console.log('Processing geometry…');
const geoRaw = readPlist('world-geometry.plist');
const geometry = {};

for (const [name, data] of Object.entries(geoRaw.data.lands)) {
  const paths = data.paths ?? {};
  geometry[name] = {
    land: paths.land ?? [],
    island: paths.island ?? [],
    clickable: paths.clickable ?? []
  };
}
for (const [name, data] of Object.entries(geoRaw.data.lakes)) {
  const paths = data.paths ?? {};
  geometry[`lake:${name}`] = {
    land: paths.border ?? [],
    island: [],
    clickable: []
  };
}

writeFileSync(join(OUTPUT, 'geometry.json'), JSON.stringify(geometry));
console.log(`  ${Object.keys(geometry).length} shapes`);

// ── 2. Structure ────────────────────────────────────────────────────────────

console.log('Processing structure…');
const structRaw = readPlist('world-structure.plist');
const regionsRaw = readPlist('regions-info.plist');

const geoData = structRaw.data;
const regData = regionsRaw.data;

// Display bounds known from regions-info (x y w h in SVG coordinate space)
const WORLD_BOUNDS = '662 -31 10968 5520';
const CONTINENT_BOUNDS = {
  'africa':          '4950 1452 2834 2375',   // computed + padded
  'antarctica':      '662 4200 10968 1350',
  'asia':            regData.continentalRegions.asia?.displayBounds ?? WORLD_BOUNDS,
  'central america': regData.continentalRegions['central america']?.displayBounds ?? WORLD_BOUNDS,
  'europe':          regData.continentalRegions.europe?.displayBounds ?? WORLD_BOUNDS,
  'middle east':     regData.continentalRegions['middle east']?.displayBounds ?? WORLD_BOUNDS,
  'north america':   regData.continentalRegions['north america']?.displayBounds ?? WORLD_BOUNDS,
  'oceania':         regData.continentalRegions.oceania?.displayBounds ?? WORLD_BOUNDS,
  'south america':   regData.continentalRegions['south america']?.displayBounds ?? WORLD_BOUNDS,
};

// Continental regions
const continentalRegions = {};
for (const [name, data] of Object.entries(geoData.regions.continentalRegions)) {
  continentalRegions[name] = {
    landIdentifiers: data.landIdentifiers ?? [],
    displayBounds: CONTINENT_BOUNDS[name] ?? WORLD_BOUNDS,
    navigationNeighbors: data.navigationNeighbors ?? {}
  };
}

// Provincial regions (states/provinces) — compute display bounds from geometry if missing
const provincialRegions = {};
for (const [name, data] of Object.entries(geoData.regions.provincialRegions)) {
  const knownBounds = regData.provincialRegions[name]?.displayBounds;
  let displayBounds = knownBounds ?? '';

  if (!displayBounds) {
    // Compute from geometry
    const ids = data.landIdentifiers ?? [];
    const allPaths = [];
    for (const id of ids) {
      const geo = geometry[id];
      if (geo) allPaths.push(...geo.land, ...geo.island);
    }
    if (allPaths.length) {
      const { minX, minY, maxX, maxY } = pathBounds(allPaths);
      const pad = 80;
      displayBounds = `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + pad * 2).toFixed(1)} ${(maxY - minY + pad * 2).toFixed(1)}`;
    }
  }

  provincialRegions[name] = {
    landIdentifiers: data.landIdentifiers ?? [],
    displayBounds,
    enabled: data.enabled !== false
  };
}

// Lands hierarchy
const lands = {};
for (const [name, data] of Object.entries(geoData.lands)) {
  lands[name] = {
    capital: data.capital ?? null,
    otherCities: data['other cities'] ?? []
  };
}

writeFileSync(join(OUTPUT, 'structure.json'), JSON.stringify({
  continentalRegions,
  provincialRegions,
  lands
}));
console.log(`  ${Object.keys(continentalRegions).length} continental, ${Object.keys(provincialRegions).length} provincial regions`);

// ── 3. Lands display info ───────────────────────────────────────────────────

console.log('Processing lands info…');
const landsRaw = readPlist('lands-info.plist');
const landsInfo = {};

for (const [name, data] of Object.entries(landsRaw.data)) {
  const geo = geometry[name];
  const label = geo
    ? labelInfo([...(geo.land ?? []), ...(geo.island ?? [])])
    : null;
  landsInfo[name] = {
    fillColorNumber: data.fillColorNumber ?? 0,
    countryCode: data.countryCode ?? '',
    showCircle: data.showCircle === true,
    ...(label ?? {})
  };
}

writeFileSync(join(OUTPUT, 'lands.json'), JSON.stringify(landsInfo));
console.log(`  ${Object.keys(landsInfo).length} lands`);

// ── 4. Cities ───────────────────────────────────────────────────────────────

console.log('Processing cities…');
const citiesRaw = readPlist('cities-info.plist');
const cities = {};

for (const [name, data] of Object.entries(citiesRaw.data)) {
  if (data.location) {
    const [x, y] = data.location.trim().split(/\s+/).map(Number);
    cities[name] = { x, y };
  }
}

writeFileSync(join(OUTPUT, 'cities.json'), JSON.stringify(cities));
console.log(`  ${Object.keys(cities).length} cities with coordinates`);

console.log('\nDone! Data written to static/data/');
