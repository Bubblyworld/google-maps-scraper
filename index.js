const arrayToBuffer = require('arraybuffer-to-buffer');
const puppeteer = require('puppeteer');
const geotiff = require('geotiff');
const geolib = require('geolib');
const png = require('pngjs').PNG;
var fs = require('fs');

// Test inputs pointing at Hout Bay.
const HB_LAT = -34.0460495;
const HB_LON = 18.344531;

// Test inputs pointing to Turret Peak.
const TP_LAT = -32.87282171722992
const TP_LON = 19.19763384584335;

function getUrl(lat, lon, res) {
  return `https://www.google.com/maps/@${lat},${lon},${res}m/data=!3m1!1e3`;
}

function getGisData(lat, lon, res, width, height) {
  const center = { latitude: lat, longitude: lon };

  // The midpoint on top, i.e. res/2m north of center (a bearing of 0 degrees).
  const t = geolib.computeDestinationPoint(center, res/2, 0);

  // Coordinates of the four corner points.
  // TODO resample res from url, it changes after ui is deleted.
  const tl = geolib.computeDestinationPoint(t, res/2, 270);
  const tr = geolib.computeDestinationPoint(tl, res, 90);
  const bl = geolib.computeDestinationPoint(tl, res, 180);

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

  // Reparse the resolution from the url, as hiding the ui changes it.
  // https://www.google.com/maps/@-34.0460495,18.344531,127m/data=!3m1!1e3
  //                                                     ^ we want this bit
  const url = await page.url();
  const newRes = url.split(',')[2].split('/')[0].slice(0, -1);

  // Scrape the screenshot and close the browser page.
  await page.screenshot({ path });
  await page.close();

  // Georeference the scraped image by pinning down lat/lon coordinates.
  await georeference(path, lat, lon, newRes);
}

(async () => {
  const browser = await puppeteer.launch();

  const inputs = [
    ['outputs/tp_200.png', TP_LAT, TP_LON, 200],
    ['outputs/tp_400.png', TP_LAT, TP_LON, 400],
    ['outputs/tp_800.png', TP_LAT, TP_LON, 800],
    ['outputs/tp_1600.png', TP_LAT, TP_LON, 1600],
  ];

  for (let i = 0; i < inputs.length; i++) {
    await snapshot(browser, ...inputs[i]); // no async forEach...
  }

  await browser.close();
})();
