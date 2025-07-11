# Google Earth Engine NDVI Analysis Code - Step by Step Explanation

## Overview
This code analyzes seasonal vegetation health (NDVI) for three different areas in the Okavango Delta using Sentinel-2 satellite imagery throughout 2023.

---

## Step 1: Load Data Assets
```javascript
var papyrus   = ee.FeatureCollection("projects/magmapsproject/assets/06302025_papyrus_layer");
var phragmite = ee.FeatureCollection("projects/magmapsproject/assets/phragmite");
var table     = ee.FeatureCollection("projects/ee-okavango/assets/shapes/okavango_outline_20241031");
```

**What it does:**
- Loads three geographic datasets (shapefiles/vectors) into Google Earth Engine
- `papyrus`: Areas where papyrus vegetation is found
- `phragmite`: Areas where phragmite vegetation is found  
- `table`: The entire Okavango Delta boundary outline

**Why needed:** These define our "Areas of Interest" (AOI) - the specific regions we want to analyze

---

## Step 2: Prepare Geometries
```javascript
var papyrusGeom = papyrus.geometry().dissolve({'maxError': 1});
var phragmiteGeom = phragmite.geometry().dissolve({'maxError': 1});
var okavangoDeltaGeom = table.geometry().dissolve({'maxError': 1});
```

**What it does:**
- Converts FeatureCollections to unified geometry objects
- `.dissolve()` merges multiple polygons into single, continuous shapes
- `maxError: 1` allows 1-meter tolerance for merging adjacent features

**Why needed:** 
- FeatureCollections can contain multiple separate polygons
- We need single, unified shapes for calculations
- Prevents errors when areas have gaps or overlaps

---

## Step 3: Define NDVI Calculation Function
```javascript
function getMonthlyNDVI(aoi, month, year) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end   = start.advance(1, 'month');
```

**What it does:**
- Creates a reusable function to calculate NDVI for any area and time period
- Sets up date range for one specific month (e.g., January 1-31, 2023)

**Parameters:**
- `aoi`: Area of Interest geometry
- `month`: Month number (1-12)
- `year`: Year (2023)

### Step 3a: Filter Sentinel-2 Images
```javascript
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(aoi)
            .filterDate(start, end)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50));
```

**What it does:**
- Accesses Sentinel-2 satellite imagery database
- `.filterBounds(aoi)`: Only gets images covering our study area
- `.filterDate(start, end)`: Only gets images from our target month
- `.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))`: Only keeps images with <50% cloud cover

**Why Sentinel-2:** 
- 10-meter spatial resolution (detailed)
- 5-day revisit time (frequent updates)
- Has Red (B4) and Near-Infrared (B8) bands needed for NDVI

### Step 3b: Handle Empty Collections
```javascript
var imageCount = s2.size();

s2 = ee.Algorithms.If(
  imageCount.eq(0),
  ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(start, end),
  s2
);
```

**What it does:**
- Counts how many images passed the cloud filter
- If zero images found, tries again WITHOUT cloud filter
- Ensures we always have some data to work with

**Why needed:** Some months might be very cloudy, leaving no "good" images

### Step 3c: Calculate NDVI
```javascript
var ndvi = ee.Algorithms.If(
  imageCount.gt(0),
  ee.ImageCollection(s2).median().clip(aoi).normalizedDifference(['B8','B4']).rename('NDVI'),
  ee.Image.constant(-9999).rename('NDVI')
);
```

**What it does:**
- **If images exist:**
  - `.median()`: Creates composite image using median pixel values (reduces noise)
  - `.clip(aoi)`: Cuts image to exact study area boundaries
  - `.normalizedDifference(['B8','B4'])`: Calculates NDVI = (NIR-Red)/(NIR+Red)
  - `.rename('NDVI')`: Names the result band "NDVI"
- **If no images:** Creates dummy image with value -9999 (indicates missing data)

**NDVI Calculation:**
- B8 = Near-Infrared band (vegetation reflects this strongly)
- B4 = Red band (vegetation absorbs this for photosynthesis)
- NDVI ranges from -1 to +1
- Higher values = healthier, denser vegetation

### Step 3d: Add Metadata
```javascript
return ee.Image(ndvi).set({
  'month': month, 
  'year': year,
  'system:time_start': start.millis(),
  'image_count': imageCount
});
```

**What it does:**
- Attaches information to each NDVI image:
  - `month`: Which month this represents
  - `year`: Which year 
  - `system:time_start`: Timestamp for chart x-axis
  - `image_count`: How many satellite images were used

---

## Step 4: Build Time Series
```javascript
var months = ee.List.sequence(1, 12);
var year   = 2023;

var ndviPapyrusSeries = ee.ImageCollection.fromImages(
  months.map(function(m) {
    return getMonthlyNDVI(papyrusGeom, m, year);
  })
);
```

**What it does:**
- Creates list of months [1, 2, 3, ..., 12]
- For each month, calls our function to calculate NDVI
- Results in 12 NDVI images (one per month) for each vegetation type
- Creates three time series: papyrus, phragmite, and entire delta

**Why map():** Efficiently applies the same calculation to all 12 months

---

## Step 5: Export Function
```javascript
function exportNDVIMonthlyStats(series, aoiGeom, className) {
  var features = series.map(function(img) {
    var month = img.get('month');
    var year = img.get('year');
    var imageCount = img.get('image_count');
    
    var ndviMean = img.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: aoiGeom,
      scale: 10,
      maxPixels: 1e9,
      bestEffort: true
    }).get('NDVI');
```

**What it does:**
- Takes each monthly NDVI image and calculates statistics
- `.reduceRegion()`: Calculates average NDVI across the entire study area
- `scale: 10`: Uses 10-meter resolution (Sentinel-2's native resolution)
- `maxPixels: 1e9`: Maximum pixels to process (prevents memory errors)
- `bestEffort: true`: If too many pixels, automatically reduces resolution

### Step 5a: Create CSV Records
```javascript
return ee.Feature(null, {
  class: className,
  year: year,
  month: month,
  date: ee.String(ee.Number(year).format()).cat('-').cat(ee.Number(month).format('%02d')),
  ndvi_mean: ndviMean,
  image_count: imageCount
});
```

**What it does:**
- Creates a data record for each month
- Formats date as "2023-01", "2023-02", etc.
- Stores vegetation type name, NDVI average, and image count

### Step 5b: Export to Google Drive
```javascript
Export.table.toDrive({
  collection: ee.FeatureCollection(features),
  description: className + '_NDVI_Stats_2023',
  folder: 'EE_Seasonal_NDVI',
  fileFormat: 'CSV'
});
```

**What it does:**
- Converts data to CSV format
- Saves to Google Drive in folder "EE_Seasonal_NDVI"
- Creates separate files: "Papyrus_NDVI_Stats_2023.csv", etc.

---

## Step 6: Create Visualizations

### Step 6a: Filter Valid Data
```javascript
var papyrusValid = ndviPapyrusSeries.filter(ee.Filter.gt('image_count', 0));
var phragmiteValid = ndviPhragmiteSeries.filter(ee.Filter.gt('image_count', 0));
var okavangoDeltaValid = ndviOkavangoDeltaSeries.filter(ee.Filter.gt('image_count', 0));
```

**What it does:**
- Removes months with no satellite data (image_count = 0)
- Prevents charts from showing meaningless -9999 values

### Step 6b: Individual Charts
```javascript
var chartPapyrus = ui.Chart.image.series({
  imageCollection: papyrusValid,
  region: papyrusGeom,
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Seasonal NDVI – Papyrus',
  hAxis: {title: 'Month'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3,
  colors: ['green']
});
```

**What it does:**
- Creates time series line chart
- X-axis: Months throughout 2023
- Y-axis: Average NDVI values (0-1 scale)
- Shows seasonal vegetation patterns

### Step 6c: Combined Comparison Chart
```javascript
var combinedChart = ui.Chart.image.series({
  imageCollection: papyrusValid.merge(phragmiteValid).merge(okavangoDeltaValid),
  //... styling options
  colors: ['green', 'blue', 'orange'],
  series: {
    0: {labelInLegend: 'Papyrus'},
    1: {labelInLegend: 'Phragmite'},
    2: {labelInLegend: 'Okavango Delta'}
  }
});
```

**What it does:**
- Combines all three vegetation types on one chart
- Different colors for each line
- Allows direct comparison of seasonal patterns

---

## Step 7: Map Visualization
```javascript
Map.centerObject(okavangoDeltaGeom, 8);
Map.addLayer(okavangoDeltaGeom, {color: 'orange', fillColor: 'orange00'}, 'Okavango Delta Outline');
Map.addLayer(papyrusGeom, {color: 'green'}, 'Papyrus AOI');
Map.addLayer(phragmiteGeom, {color: 'blue'}, 'Phragmite AOI');
```

**What it does:**
- Centers map on Okavango Delta
- Shows study area boundaries in different colors
- Provides geographic context for the analysis

### Step 7a: NDVI Visualization
```javascript
var sampleMonth = 6; // June
var sampleNDVI = getMonthlyNDVI(okavangoDeltaGeom, sampleMonth, year);

Map.addLayer(sampleNDVI, {
  min: 0,
  max: 1,
  palette: ['red', 'yellow', 'green']
}, 'Sample NDVI (June 2023) - Okavango Delta');
```

**What it does:**
- Shows actual NDVI values as colors across the landscape
- Red = Low vegetation (0.0-0.3)
- Yellow = Medium vegetation (0.3-0.7)  
- Green = High vegetation (0.7-1.0)
- Uses June as example month

---

## Summary of Outputs

**CSV Files (3 total):**
- Monthly NDVI averages for each vegetation type
- Shows seasonal patterns, data availability

**Charts (4 total):**
- Individual trend lines for each area
- Combined comparison chart
- Shows which vegetation is healthiest when

**Map Layers:**
- Study area boundaries
- Visual NDVI patterns across landscape
- Geographic context

**Key Insights Possible:**
- Which vegetation type has highest NDVI?
- When is the growing season (NDVI peaks)?
- How much seasonal variation exists?
- Which months have poor satellite coverage?