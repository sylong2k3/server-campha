# Cấu hình mô hình ngập lụt (M1–M5)

Tài liệu này dành cho cán bộ vận hành, kiểm định và phát triển chức năng ngập lụt Cẩm Phả. Mục tiêu là phân biệt rõ thông tin người vận hành cần nhập với các tham số khoa học/hạ tầng được server quản lý tập trung.

## Vì sao hệ thống có nhiều cấu hình?

Các cấu hình không cùng một mục đích:

| Nhóm                      | Nơi quản lý                               | Ai thay đổi                       | Mục đích                                                                                             |
| ------------------------- | ----------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Dữ liệu của một lượt chạy | Form quản trị                             | Cán bộ vận hành có quyền chạy     | Chọn thời gian, mực nước kịch bản, nguồn/số liệu mưa hoặc lượt chạy nguồn.                           |
| Tham số khoa học chuẩn    | `src/services/flood/config/defaults.js`   | Nhóm chuyên môn sau khi kiểm định | Giữ nhất quán ngưỡng phân loại, địa hình và kiểm soát nhiễu.                                         |
| Kiểm tra dữ liệu đầu vào  | `src/services/flood/config/schema.js`     | Nhóm phát triển                   | Chỉ cho phép khóa và miền giá trị đã được thẩm định.                                                 |
| Phiên bản mô hình         | `src/services/flood/config/versions.js`   | Nhóm phát triển                   | Gắn phiên bản vào từng lượt chạy để truy xuất lại kết quả lịch sử.                                   |
| Hạ tầng vận hành          | `src/configs/flood.js` và biến môi trường | Quản trị hệ thống                 | Kết nối GCS/MinIO, thời gian chờ ingest, lịch M5 và chế độ debug. Không hiển thị cho người vận hành. |

Vì vậy, số lượng cấu hình trong server là cần thiết để đảm bảo kết quả có thể lặp lại và vận hành an toàn. Điều đó **không** có nghĩa người dùng phải nhập toàn bộ cấu hình khi tạo lượt phân tích.

## Quy tắc vận hành

- Server dùng bộ mặc định đã phiên bản hóa và lưu `pipeline_version`, `config_version` cùng bản chụp tham số vào mỗi lượt chạy.
- Form quản trị chỉ yêu cầu dữ liệu riêng của lần chạy. Các ngưỡng khoa học không xuất hiện dưới dạng JSON.
- Chế độ `product` là quy trình bình thường, có thể công bố sau khi hoàn tất kiểm định.
- Chế độ `calibration` dành cho cán bộ có quyền hiệu chỉnh; artifact calibration chỉ để kiểm định và không được công bố trực tiếp.
- M3 là **chỉ số nguy cơ tương đối**, không phải xác suất ngập đã hiệu chuẩn. Không dùng riêng M3 để thay thế kiểm tra hiện trường.
- Bất kỳ thay đổi ngưỡng khoa học nào phải kèm: giá trị cũ/mới, lý do, bằng chứng, tác động dự kiến và cách kiểm định. Không sửa trực tiếp theo từng lượt chạy product.

## Thông tin nhập trên giao diện quản trị

### M1 · Hiện trạng ngập từ Sentinel-1

Người vận hành nhập hai khoảng thời gian:

| Trường                            | Bắt buộc | Ý nghĩa                                                             |
| --------------------------------- | -------- | ------------------------------------------------------------------- |
| Kỳ nền — từ ngày / đến ngày       | Có       | Khoảng ảnh trước sự kiện để làm mốc so sánh.                        |
| Kỳ phân tích — từ ngày / đến ngày | Có       | Khoảng ảnh cần xác định hiện trạng ngập.                            |
| Tính tác động sau M1              | Không    | Tự tạo M4 để thống kê dân cư, công trình và hạ tầng chịu ảnh hưởng. |

Server kiểm tra ngày kết thúc không sớm hơn ngày bắt đầu. Các thông số như quỹ đạo, phương pháp ngưỡng, loại nước thường trực, độ dốc/HAND, lọc vùng nhỏ và nhánh ngập nông dùng bộ mặc định đã phê duyệt.

### M2 · Nhạy cảm địa hình (HAND)

| Trường                | Bắt buộc | Ý nghĩa                                | Mặc định chuẩn |
| --------------------- | -------- | -------------------------------------- | -------------- |
| Mực nước giả định (m) | Không    | Cao độ nước của kịch bản cần mô phỏng. | 5 m            |

Server dùng giới hạn độ dốc 12°. Form chỉ cho phép đổi mực nước kịch bản để tránh vô tình thay đổi các điều kiện địa hình.

### M3 · Chỉ số nguy cơ dựa trên mưa

| Trường                              | Bắt buộc                 | Ý nghĩa                                        | Mặc định chuẩn |
| ----------------------------------- | ------------------------ | ---------------------------------------------- | -------------- |
| Nguồn dữ liệu mưa                   | Có                       | `IMERG` (vệ tinh) hoặc số liệu đo nhập tay.    | `IMERG`        |
| Ngày xảy ra mưa                     | Có khi dùng IMERG        | Ngày server truy xuất dữ liệu IMERG.           | —              |
| Lượng mưa 3h/6h/24h/72h/7d/30d (mm) | Ít nhất một khi nhập tay | Chuỗi lượng mưa tích lũy.                      | —              |
| Ngưỡng cảnh báo                     | Không                    | Ngưỡng đánh dấu pixel nguy cơ cao, từ 0 đến 1. | 0,6            |

Khi dùng IMERG phải có ngày xảy ra mưa. Khi nhập tay phải có ít nhất một giá trị lượng mưa không âm. Không đổi ngưỡng 0,6 nếu chưa có bằng chứng kiểm định.

### M4 · Tác động ngập

| Trường                   | Bắt buộc | Ý nghĩa                                                                              | Mặc định chuẩn |
| ------------------------ | -------- | ------------------------------------------------------------------------------------ | -------------- |
| Nguồn lớp ngập           | Có       | Kết quả M1, M2 hoặc M3 làm đầu vào thống kê.                                         | M1             |
| Mã lượt chạy nguồn       | Không    | Chỉ định chính xác lượt chạy cần thống kê; để trống thì server chọn kết quả phù hợp. | —              |
| Loại trừ vùng thủy triều | Không    | Chỉ thống kê vùng ngập chính, giảm nhiễu do dao động thủy triều.                     | Bật            |

### M5 · Xu thế nhiều năm

| Trường                                 | Bắt buộc | Ý nghĩa                                                    |
| -------------------------------------- | -------- | ---------------------------------------------------------- |
| Kỳ nền khô — từ ngày / đến ngày        | Có       | Mốc khô để so sánh biến động.                              |
| Bốn đợt phân tích — từ ngày / đến ngày | Có       | Các kỳ mưa/ngập được so sánh để tính tần suất và thay đổi. |

M5 cần ít nhất hai đợt; giao diện chuẩn cung cấp bốn đợt để phù hợp cấu hình hiện hành. Server kiểm tra từng khoảng ngày và dùng các ngưỡng ratio, độ dốc, HAND, tần suất cảnh báo, Dynamic World và kiểm định quang học đã được phiên bản hóa.

## Tham số khoa học được khóa theo bộ chuẩn

Đây là các tham số quan trọng, được đặt tại `src/services/flood/config/defaults.js`. Người vận hành đọc để hiểu kết quả, không cần nhập JSON để thay đổi.

| Mô-đun | Tham số chính                                            | Giá trị V1                                                    |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| M1     | Giảm VH/VV, tỉ số VH, ngưỡng nước tối, giới hạn dốc/HAND | 2,0 dB / 0,8 dB / 1,3 / 5° / 12 m                             |
| M1     | Chế độ ngưỡng, số phiếu tối thiểu, diện tích nhỏ nhất    | `fixed`, 2, 1.000 m²                                          |
| M1     | Ngập nông / phản xạ kép đô thị                           | Bật ngập nông; tắt phản xạ kép đô thị theo bằng chứng hiện có |
| M2     | Mực nước / độ dốc                                        | 5 m / 12°                                                     |
| M3     | Nguồn / ngưỡng chỉ số nguy cơ                            | `IMERG` / 0,6                                                 |
| M4     | Nguồn tác động / loại trừ thủy triều                     | M1 / bật                                                      |
| M5     | Ratio VV/VH, dốc/HAND, cảnh báo tần suất                 | 1,2 / 1,58, 5° / 12 m, 50%                                    |
| Chung  | AOI / phép chiếu                                         | Ranh giới tham chiếu Cẩm Phả, `EPSG:32648` ở 30 m             |

Giá trị đầy đủ và các chú thích nguồn/bằng chứng nằm trực tiếp cạnh từng hằng số trong `defaults.js`; schema hiện hành là danh sách khóa hợp lệ chính thức.

## API cho tích hợp kỹ thuật

Giao diện quản trị không yêu cầu JSON. API vẫn nhận `config` để phục vụ tích hợp được kiểm soát:

```json
{
    "module": "hand",
    "mode": "product",
    "config": {
        "levelM": 7
    }
}
```

Server từ chối khóa không có trong schema. API `GET /admin/flood/config` trả về bộ mặc định và phiên bản an toàn để giao diện hiển thị; không trả về khóa dịch vụ hay bí mật hạ tầng.

## Thay đổi cấu hình chuẩn

1. Tạo đề xuất nêu rõ tham số cũ, tham số mới, lý do và bằng chứng.
2. Chạy `calibration` trên bộ dữ liệu đại diện, lưu artifact và chỉ số kiểm định.
3. Có người phụ trách chuyên môn phê duyệt tác động dự kiến.
4. Cập nhật `defaults.js`, schema (nếu cần), tài liệu này và tạo **phiên bản mới** trong `versions.js`.
5. Chạy lại kiểm thử cấu hình và kiểm thử mô-đun liên quan trước khi triển khai.

Không đổi lại số hiệu phiên bản cũ: kết quả lịch sử phải luôn diễn giải được theo đúng bộ tham số đã chạy.
