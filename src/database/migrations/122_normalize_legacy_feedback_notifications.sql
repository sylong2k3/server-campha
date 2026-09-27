-- Migration 122: Chuẩn hóa dữ liệu thông báo phản ánh cũ trong core.notifications từ tiếng Anh sang tiếng Việt

UPDATE core.notifications
SET body = REPLACE(body, ': resolved', ': Đã xử lý')
WHERE body LIKE '%: resolved%';

UPDATE core.notifications
SET body = REPLACE(body, ': approved', ': Đã phê duyệt')
WHERE body LIKE '%: approved%';

UPDATE core.notifications
SET body = REPLACE(body, ': under_review', ': Đang xem xét')
WHERE body LIKE '%: under_review%';

UPDATE core.notifications
SET body = REPLACE(body, ': rejected', ': Đã từ chối')
WHERE body LIKE '%: rejected%';

UPDATE core.notifications
SET body = REPLACE(body, ': pending', ': Chờ tiếp nhận')
WHERE body LIKE '%: pending%';

-- Chuẩn hóa lỗi chính tả nếu có
UPDATE core.notifications
SET body = REPLACE(body, 'Trạng thái phan ánh', 'Trạng thái phản ánh')
WHERE body LIKE '%Trạng thái phan ánh%';
