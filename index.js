const arrayToBuffer = require('arraybuffer-to-buffer');
const puppeteer = require('puppeteer');
const geotiff = require('geotiff');
const geolib = require('geolib');
const png = require('pngjs').PNG;
var fs = require('fs');

// Test inputs pointing at Hout Bay.
const TEST_LAT = -34.0460495;
const TEST_LON = 18.344531;

function getUrl(lat, lon, res) {
  return `https://www.google.com/maps/@${lat},${lon},${res}m/data=!3m1!1e3`;
}

function getGisData(lat, lon, res, width, height) {
  const center = { latitude: lat, longitude: lon };

  // The midpoint on top, i.e. res/2m north of center (a bearing of 0 degrees).
  const t = geolib.computeDestinationPoint(center, res/2, 0);

  // Coordinates of the four corner points.
  const tl = geolib.computeDestinationPoint(t, res/2, 270);
  const tr = geolib.computeDestinationPoint(tl, res/2, 90);
  const bl = geolib.computeDestinationPoint(tl, res/2, 180);

  return {
    tiepoint: [0, 0, 0, tl.longitude, tl.latitude, 0],
    scale: [
      (tr.longitude - tl.longitude) / width,
      (tl.latitude - bl.latitude) / height,
      0,
    ],
  };
}

async function georeference(path, lat, lon, res) {
  const raw = fs.readFileSync(path);
  const parsed = png.sync.read(raw);
  const gis = getGisData(lat, lon, res, parsed.width, parsed.height);

  const tiff = await geotiff.writeArrayBuffer(parsed.data, {
    width: parsed.width,
    height: parsed.height,

    // General pixel sample encoding data.
    ExtraSamples: 1, // a channel is ignored by tiff, need to mark as extra
    SamplesPerPixel: 4, // we encode rgb and an a channel
    PhotometricInterpretation: 2, // sets rgb (no a) mode

    // Coordinate transformation data.
    GTModelTypeGeoKey: 2, // geographic coordinate system
    GTRasterTypeGeoKey: 1, // pixel is area
    GeographicTypeGeoKey: 4326, // WGS84 standard geographic coordinates
    ModelTiepoint: gis.tiepoint, // top left corner in coordinates
    ModelPixelScale: gis.scale, // lon/lat scale per pixel
  });

  fs.writeFileSync(`${path}.tif`, arrayToBuffer(tiff));
}

async function hideElement(page, selector) {
  const ele = await page.$(selector);
  await ele.evaluate((node) => node.style.display = 'none');
}


async function snapshot(browser, path, lat, lon, res) {
  // Launch page and point it at the google maps satellite url.
  const page = await browser.newPage();
  await page.setViewport({
    width: 1024,
    height: 1024,
  });
  await page.goto(getUrl(lat, lon, res), {
    waitUntil: 'networkidle0', // waits until network stops loading stuff
  });

  // Switch off labels.
  const check = await page.$('[jsaction="layerswitcher.intent.labels"]');
  await check.evaluate((node) => node.click());

  // Remove the UI overlays.
  await hideElement(page, '#omnibox-container');
  await hideElement(page, '#assistive-chips');
  await hideElement(page, '#vasquette');
  await hideElement(page, '#minimap');
  await hideElement(page, '#watermark');
  await hideElement(page, '#runway');
  await hideElement(page, '.app-bottom-content-anchor');
  await hideElement(page, '.scene-footer-container');

  // Scrape the screenshot and close the browser page.
  await page.screenshot({ path });
  await page.close();

  // Georeference the scraped image by pinning down lat/lon coordinates.
  await georeference(path, lat, lon, res);
}

(async () => {
  const browser = await puppeteer.launch();

  const inputs = [
    ['outputs/100.png', TEST_LAT, TEST_LON, 100],
    ['outputs/200.png', TEST_LAT, TEST_LON, 200],
    ['outputs/400.png', TEST_LAT, TEST_LON, 400],
    ['outputs/800.png', TEST_LAT, TEST_LON, 800],
  ];

  for (let i = 0; i < inputs.length; i++) {
    await snapshot(browser, ...inputs[i]); // no async forEach...
  }

  await browser.close();
})();
