<?xml version="1.0" encoding="UTF-8"?>
<!--
  SLD Style: forecast_flood_mask
  Lớp phủ dự báo ngập — nhị phân (0 = không ngập, 1 = ngập dự báo)

  Màu sắc:
    1 (ngập dự báo) → xanh dương đậm #1565C0, opacity 0.75
    0 (không ngập)  → trong suốt (noData / masked)

  Pixel giá trị 0 vẫn hiển thị trong suốt nhờ ColorMapEntry opacity="0".
-->
<StyledLayerDescriptor version="1.0.0"
    xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>forecast_flood_mask</Name>
    <UserStyle>
      <Title>Lớp phủ dự báo ngập (nhị phân)</Title>
      <Abstract>
        Dự báo vùng ngập kịch bản mưa + thuỷ triều. Giá trị 1 = dự báo ngập.
        Đây là KỊ CH BẢN, không phải ngập quan sát thực tế.
      </Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>0.78</Opacity>
            <ColorMap type="values">
              <!-- 0: không ngập → trong suốt -->
              <ColorMapEntry color="#000000" quantity="0" label="Không ngập" opacity="0"/>
              <!-- 1: dự báo ngập → xanh dương đậm -->
              <ColorMapEntry color="#1565C0" quantity="1" label="Dự báo ngập" opacity="0.85"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
