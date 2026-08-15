<?xml version="1.0" encoding="UTF-8"?>
<!--
  SLD Style: forecast_flood_class
  Lớp phủ dự báo ngập — phân lớp 3 mức (Byte: 1 / 2 / 3)

  Bảng màu:
    1 = Thấp    → vàng nhạt   #FFF59D  (rủi ro thấp)
    2 = Trung   → cam         #FF8F00  (rủi ro trung bình)
    3 = Cao     → đỏ đậm      #B71C1C  (ngập chắc chắn tại h_eff)

  Pixel ngoài mask (NoData / giá trị 0) → trong suốt.

  Phân lớp dựa trên khoảng cách HAND đến h_eff:
    Cao  : HAND ≤ h_eff         (ID = 3)
    Trung: HAND ≤ 1.4 × h_eff   (ID = 2)
    Thấp : HAND ≤ 2.0 × h_eff   (ID = 1)
-->
<StyledLayerDescriptor version="1.0.0"
    xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>forecast_flood_class</Name>
    <UserStyle>
      <Title>Dự báo ngập — phân lớp (Thấp / Trung bình / Cao)</Title>
      <Abstract>
        Phân lớp 3 mức nguy cơ ngập dự báo theo kịch bản mưa + thuỷ triều.
        1 = Thấp · 2 = Trung bình · 3 = Cao. Đây là KỊ CH BẢN.
      </Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>0.80</Opacity>
            <ColorMap type="values">
              <!-- Các giá trị ngoài phân lớp → trong suốt -->
              <ColorMapEntry color="#000000" quantity="0" label="Không xác định" opacity="0"/>
              <!-- 1 = Thấp -->
              <ColorMapEntry color="#FFF59D" quantity="1" label="Thấp" opacity="0.70"/>
              <!-- 2 = Trung bình -->
              <ColorMapEntry color="#FF8F00" quantity="2" label="Trung bình" opacity="0.82"/>
              <!-- 3 = Cao -->
              <ColorMapEntry color="#B71C1C" quantity="3" label="Cao" opacity="0.90"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
