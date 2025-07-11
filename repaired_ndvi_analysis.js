// ------------ START: Setup AOIs ------------ //
var papyrus   = ee.FeatureCollection("projects/magmapsproject/assets/06302025_papyrus_layer");
var phragmite = ee.FeatureCollection("projects/magmapsproject/assets/phragmite");

// Get unified geometries for AOIs (handles multi-feature collections properly)
var papyrusGeom = papyrus.geometry().dissolve({'maxError': 1});
var phragmiteGeom = phragmite.geometry().dissolve({'maxError': 1});

// ------------ FUNCTION: Monthly NDVI Composite ------------ //
function getMonthlyNDVI(aoi, month, year) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end   = start.advance(1, 'month');
  
  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
              .filterBounds(aoi)
              .filterDate(start, end)
              .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10));
  
  // Check if any images are available
  var imageCount = s2.size();
  
  var composite = s2.median().clip(aoi);
  
  var ndvi = composite.normalizedDifference(['B8','B4']).rename('NDVI')
               .set({
                 'month': month, 
                 'year': year,
                 'system:time_start': start.millis(),
                 'image_count': imageCount
               });
  
  return ndvi;
}

// ------------ BUILD NDVI TIME SERIES ------------ //
var months = ee.List.sequence(1, 12); // All months (removed unnecessary leading zero)
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

// ------------ PLOT NDVI TRENDS ------------ //
var chartPapyrus = ui.Chart.image.series({
  imageCollection: ndviPapyrusSeries,
  region: papyrusGeom,
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Seasonal NDVI – Papyrus',
  hAxis: {title: 'Month', format: 'MM'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3,
  interpolateNulls: true
});
print(chartPapyrus);

var chartPhragmite = ui.Chart.image.series({
  imageCollection: ndviPhragmiteSeries,
  region: phragmiteGeom,
  reducer: ee.Reducer.mean(),
  scale: 10,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Seasonal NDVI – Phragmite',
  hAxis: {title: 'Month', format: 'MM'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3,
  interpolateNulls: true
});
print(chartPhragmite);

// ------------ EXPORT NDVI MEAN PER MONTH ------------ //
function exportNDVIMonthlyStats(series, aoiGeom, className) {
  var features = series.map(function(img) {
    var month = img.get('month');
    var year = img.get('year');
    var imageCount = img.get('image_count');
    
    var stats = img.reduceRegion({
      reducer: ee.Reducer.mean().combine({
        reducer2: ee.Reducer.stdDev(),
        sharedInputs: true
      }),
      geometry: aoiGeom,
      scale: 10,
      maxPixels: 1e9, // Reduced from 1e13 to prevent memory issues
      bestEffort: true,
      tileScale: 2
    });
    
    return ee.Feature(null, {
      class: className,
      year: year,
      month: month,
      date: ee.String(ee.Number(year).format()).cat('-').cat(ee.Number(month).format('%02d')),
      ndvi_mean: stats.get('NDVI_mean'),
      ndvi_stdDev: stats.get('NDVI_stdDev'),
      image_count: imageCount
    });
  });
  
  Export.table.toDrive({
    collection: ee.FeatureCollection(features),
    description: className + '_NDVI_MonthlyStats_' + year,
    folder: 'EE_Seasonal_NDVI',
    fileFormat: 'CSV'
  });
}

// Execute exports
exportNDVIMonthlyStats(ndviPapyrusSeries, papyrusGeom, 'Papyrus');
exportNDVIMonthlyStats(ndviPhragmiteSeries, phragmiteGeom, 'Phragmite');

// ------------ OPTIONAL: Add some debugging info ------------ //
print('Papyrus geometry type:', papyrusGeom.type());
print('Phragmite geometry type:', phragmiteGeom.type());
print('NDVI series size (Papyrus):', ndviPapyrusSeries.size());
print('NDVI series size (Phragmite):', ndviPhragmiteSeries.size());

// Print first image info to check data availability
var firstImage = ee.Image(ndviPapyrusSeries.first());
print('First image properties:', firstImage.toDictionary());