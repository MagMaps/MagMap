# Google Earth Engine NDVI Analysis - Complete Code with Step-by-Step Explanation

## Overview
This code analyzes seasonal vegetation health (NDVI) for three different areas in the Okavango Delta using Sentinel-2 satellite imagery throughout 2023.

---

# STEP 1: LOAD DATA ASSETS

```javascript
// ------------ SCRIPT WITH OKAVANGO DELTA OUTLINE ------------ //
var papyrus   = ee.FeatureCollection("projects/magmapsproject/assets/06302025_papyrus_layer");
var phragmite = ee.FeatureCollection("projects/magmapsproject/assets/phragmite");
var table     = ee.FeatureCollection("projects/ee-okavango/assets/shapes/okavango_outline_20241031");
```

**What it does:**
- Loads three geographic datasets (shapefiles/vectors) into Google Earth Engine
- `papyrus`: Areas where papyrus vegetation is found
- `phragmite`: Areas where phragmite vegetation is found  
- `table`: The entire Okavango Delta boundary outline

---

# STEP 2: PREPARE GEOMETRIES

```javascript
// Get unified geometries for AOIs
var papyrusGeom = papyrus.geometry().dissolve({'maxError': 1});
var phragmiteGeom = phragmite.geometry().dissolve({'maxError': 1});
var okavangoDeltaGeom = table.geometry().dissolve({'maxError': 1});
```

**What it does:**
- Converts FeatureCollections to unified geometry objects
- `.dissolve()` merges multiple polygons into single, continuous shapes
- `maxError: 1` allows 1-meter tolerance for merging adjacent features

---

# STEP 3: DEFINE NDVI CALCULATION FUNCTION

```javascript
// ------------ FUNCTION: Monthly NDVI Composite ------------ //
function getMonthlyNDVI(aoi, month, year) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end   = start.advance(1, 'month');
  
  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
              .filterBounds(aoi)
              .filterDate(start, end)
              .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50));
  
  var imageCount = s2.size();
  
  // If no images, try without cloud filter
  s2 = ee.Algorithms.If(
    imageCount.eq(0),
    ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterBounds(aoi)
      .filterDate(start, end),
    s2
  );
  
  imageCount = ee.ImageCollection(s2).size();
  
  // Create a dummy NDVI image if no data exists
  var ndvi = ee.Algorithms.If(
    imageCount.gt(0),
    ee.ImageCollection(s2).median().clip(aoi).normalizedDifference(['B8','B4']).rename('NDVI'),
    ee.Image.constant(-9999).rename('NDVI')
  );
  
  return ee.Image(ndvi).set({
    'month': month, 
    'year': year,
    'system:time_start': start.millis(),
    'image_count': imageCount
  });
}
```

**What each part does:**

**3a. Set up date range:**
```javascript
var start = ee.Date.fromYMD(year, month, 1);
var end   = start.advance(1, 'month');
```
- Creates start and end dates for the target month

**3b. Filter Sentinel-2 images:**
```javascript
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(aoi)
            .filterDate(start, end)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50));
```
- Gets satellite images covering the study area for the target month
- Only keeps images with <50% cloud cover

**3c. Handle empty collections:**
```javascript
s2 = ee.Algorithms.If(
  imageCount.eq(0),
  ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(start, end),
  s2
);
```
- If no images pass cloud filter, tries again without cloud filter

**3d. Calculate NDVI:**
```javascript
var ndvi = ee.Algorithms.If(
  imageCount.gt(0),
  ee.ImageCollection(s2).median().clip(aoi).normalizedDifference(['B8','B4']).rename('NDVI'),
  ee.Image.constant(-9999).rename('NDVI')
);
```
- If images exist: creates median composite, clips to study area, calculates NDVI
- If no images: creates dummy image with -9999 (missing data flag)
- NDVI = (B8-B4)/(B8+B4) where B8=Near-Infrared, B4=Red

**3e. Add metadata:**
```javascript
return ee.Image(ndvi).set({
  'month': month, 
  'year': year,
  'system:time_start': start.millis(),
  'image_count': imageCount
});
```
- Attaches month, year, timestamp, and image count to each NDVI image

---

# STEP 4: BUILD TIME SERIES

```javascript
// ------------ BUILD NDVI TIME SERIES ------------ //
var months = ee.List.sequence(1, 12);
var year   = 2023;

var ndviPapyrusSeries = ee.ImageCollection.fromImages(
  months.map(function(m) {
    return getMonthlyNDVI(papyrusGeom, m, year);
  })
);

var ndviPhragmiteSeries = ee.ImageCollection.fromImages(
  months.map(function(m) {
    return getMonthlyNDVI(phragmiteGeom, m, year);
  })
);

var ndviOkavangoDeltaSeries = ee.ImageCollection.fromImages(
  months.map(function(m) {
    return getMonthlyNDVI(okavangoDeltaGeom, m, year);
  })
);

print('NDVI series built');
print('Papyrus series size:', ndviPapyrusSeries.size());
print('Phragmite series size:', ndviPhragmiteSeries.size());
print('Okavango Delta series size:', ndviOkavangoDeltaSeries.size());
```

**What it does:**
- Creates list of months [1, 2, 3, ..., 12]
- For each month, calls `getMonthlyNDVI()` function
- Results in 12 NDVI images per vegetation type (one per month)
- Creates three separate time series collections

---

# STEP 5: EXPORT FUNCTION

```javascript
// ------------ EXPORT FUNCTION ------------ //
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
    
    return ee.Feature(null, {
      class: className,
      year: year,
      month: month,
      date: ee.String(ee.Number(year).format()).cat('-').cat(ee.Number(month).format('%02d')),
      ndvi_mean: ndviMean,
      image_count: imageCount
    });
  });
  
  Export.table.toDrive({
    collection: ee.FeatureCollection(features),
    description: className + '_NDVI_Stats_2023',
    folder: 'EE_Seasonal_NDVI',
    fileFormat: 'CSV'
  });
  
  print('Export task created for:', className);
}

// Export all three datasets
exportNDVIMonthlyStats(ndviPapyrusSeries, papyrusGeom, 'Papyrus');
exportNDVIMonthlyStats(ndviPhragmiteSeries, phragmiteGeom, 'Phragmite');
exportNDVIMonthlyStats(ndviOkavangoDeltaSeries, okavangoDeltaGeom, 'OkavangoDelta');
```

**What each part does:**

**5a. Calculate statistics:**
```javascript
var ndviMean = img.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: aoiGeom,
  scale: 10,
  maxPixels: 1e9,
  bestEffort: true
}).get('NDVI');
```
- Calculates average NDVI across the entire study area
- Uses 10-meter resolution (Sentinel-2's native resolution)

**5b. Create data records:**
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
- Creates CSV row with vegetation type, date, NDVI average, and image count

**5c. Export to Google Drive:**
```javascript
Export.table.toDrive({
  collection: ee.FeatureCollection(features),
  description: className + '_NDVI_Stats_2023',
  folder: 'EE_Seasonal_NDVI',
  fileFormat: 'CSV'
});
```
- Saves data as CSV files in Google Drive folder "EE_Seasonal_NDVI"

---

# STEP 6: CREATE VISUALIZATIONS

```javascript
// ------------ CREATE CHARTS FOR VALID DATA ------------ //
var papyrusValid = ndviPapyrusSeries.filter(ee.Filter.gt('image_count', 0));
var phragmiteValid = ndviPhragmiteSeries.filter(ee.Filter.gt('image_count', 0));
var okavangoDeltaValid = ndviOkavangoDeltaSeries.filter(ee.Filter.gt('image_count', 0));

print('Valid months - Papyrus:', papyrusValid.size());
print('Valid months - Phragmite:', phragmiteValid.size());
print('Valid months - Okavango Delta:', okavangoDeltaValid.size());

// Individual charts
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
print(chartPapyrus);

var chartPhragmite = ui.Chart.image.series({
  imageCollection: phragmiteValid,
  region: phragmiteGeom,
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Seasonal NDVI – Phragmite',
  hAxis: {title: 'Month'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3,
  colors: ['blue']
});
print(chartPhragmite);

var chartOkavangoDelta = ui.Chart.image.series({
  imageCollection: okavangoDeltaValid,
  region: okavangoDeltaGeom,
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Seasonal NDVI – Okavango Delta',
  hAxis: {title: 'Month'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3,
  colors: ['orange']
});
print(chartOkavangoDelta);

// ------------ COMBINED COMPARISON CHART ------------ //
var combinedChart = ui.Chart.image.series({
  imageCollection: papyrusValid.merge(phragmiteValid).merge(okavangoDeltaValid),
  region: papyrusGeom.union(phragmiteGeom).union(okavangoDeltaGeom),
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Seasonal NDVI Comparison - Papyrus vs Phragmite vs Okavango Delta',
  hAxis: {title: 'Month'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3,
  colors: ['green', 'blue', 'orange'],
  series: {
    0: {labelInLegend: 'Papyrus'},
    1: {labelInLegend: 'Phragmite'},
    2: {labelInLegend: 'Okavango Delta'}
  }
});
print(combinedChart);
```

**What each part does:**

**6a. Filter valid data:**
```javascript
var papyrusValid = ndviPapyrusSeries.filter(ee.Filter.gt('image_count', 0));
```
- Removes months with no satellite data (prevents -9999 values in charts)

**6b. Individual charts:**
```javascript
var chartPapyrus = ui.Chart.image.series({
  imageCollection: papyrusValid,
  region: papyrusGeom,
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
})
```
- Creates time series line chart for each vegetation type
- X-axis: Months, Y-axis: NDVI values (0-1)

**6c. Combined chart:**
```javascript
var combinedChart = ui.Chart.image.series({
  imageCollection: papyrusValid.merge(phragmiteValid).merge(okavangoDeltaValid),
  //...
  colors: ['green', 'blue', 'orange'],
})
```
- Shows all three vegetation types on one chart for comparison

---

# STEP 7: MAP VISUALIZATION

```javascript
// ------------ ADD LAYERS TO MAP ------------ //
Map.centerObject(okavangoDeltaGeom, 8);
Map.addLayer(okavangoDeltaGeom, {color: 'orange', fillColor: 'orange00'}, 'Okavango Delta Outline');
Map.addLayer(papyrusGeom, {color: 'green'}, 'Papyrus AOI');
Map.addLayer(phragmiteGeom, {color: 'blue'}, 'Phragmite AOI');

// Add a sample NDVI image for visualization
var sampleMonth = 6; // June
var sampleNDVI = getMonthlyNDVI(okavangoDeltaGeom, sampleMonth, year);

Map.addLayer(sampleNDVI, {
  min: 0,
  max: 1,
  palette: ['red', 'yellow', 'green']
}, 'Sample NDVI (June 2023) - Okavango Delta');

// Add another NDVI layer with better visualization
var ndviViz = {
  min: 0.2,
  max: 0.8,
  palette: ['brown', 'yellow', 'lightgreen', 'darkgreen']
};
Map.addLayer(sampleNDVI, ndviViz, 'NDVI Detailed (June 2023)');

print('Script completed! Check Tasks tab to run exports.');
print('Analysis includes Papyrus, Phragmite, and entire Okavango Delta region.');
```

**What each part does:**

**7a. Add study area boundaries:**
```javascript
Map.addLayer(okavangoDeltaGeom, {color: 'orange', fillColor: 'orange00'}, 'Okavango Delta Outline');
Map.addLayer(papyrusGeom, {color: 'green'}, 'Papyrus AOI');
Map.addLayer(phragmiteGeom, {color: 'blue'}, 'Phragmite AOI');
```
- Shows study area boundaries in different colors on the map

**7b. Add NDVI visualization:**
```javascript
Map.addLayer(sampleNDVI, {
  min: 0,
  max: 1,
  palette: ['red', 'yellow', 'green']
}, 'Sample NDVI (June 2023) - Okavango Delta');
```
- Shows actual NDVI values as colors across the landscape
- Red = Low vegetation, Yellow = Medium, Green = High vegetation

---

# SUMMARY OF OUTPUTS

**🗂️ CSV Files (3 total):**
- `Papyrus_NDVI_Stats_2023.csv`
- `Phragmite_NDVI_Stats_2023.csv`  
- `OkavangoDelta_NDVI_Stats_2023.csv`

**📊 Charts (4 total):**
- Individual seasonal trend charts for each vegetation type
- Combined comparison chart showing all three together

**🗺️ Map Layers:**
- Study area boundaries (colored outlines)
- NDVI visualization showing vegetation health patterns
- Geographic context for the analysis

**🔍 Scientific Insights:**
- Seasonal vegetation patterns
- Vegetation health comparisons
- Data quality assessment
- Growing season identification