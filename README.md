# Chat Avatar: mỗi chat một avatar riêng

Extension cho SillyTavern. Dùng một thẻ nhân vật (ví dụ hệ thống R21) cho nhiều chat,
và mỗi chat hiện một avatar khác nhau.

- Avatar được lưu trong **file chat** (`chat_metadata.chat_avatar`), nên chuyển chat là avatar đổi theo.
  Branch hay backup chat cũng giữ avatar.
- Ảnh tải lên được thu nhỏ (mặc định cạnh dài 768px), rồi lưu vào
  `data/<user>/user/images/chat-avatars/` trên VPS.
- Avatar riêng hiện ở: tin nhắn của nhân vật trong khung chat, danh sách **Chat gần đây** ở màn hình chào,
  và danh sách **lịch sử chat** (Manage chat files). Ảnh thẻ trong danh sách nhân vật vẫn giữ nguyên.
- Hai danh sách chat đọc từ một bảng tra lưu trong cài đặt của extension (nằm trên server, đồng bộ giữa các máy).
  Chat nào đã đặt avatar từ trước bản 1.1 thì mở chat đó một lần là danh sách cập nhật.
- Group chat chưa được hỗ trợ.

## Cài đặt

### Cách nhanh: cài bằng link
Trong SillyTavern: **Extensions** (biểu tượng khối hộp) → **Install extension** → dán link:

```
https://github.com/keycorn23-del/SillyTavern-ChatAvatar
```

Bấm *Install*. Khi có bản mới, vào **Manage extensions** rồi bấm nút cập nhật ở dòng Chat Avatar.

### Cách thủ công: chép file lên VPS
Chép cả thư mục `chat-avatar` vào thư mục extension của user trên VPS:

```
<thư mục SillyTavern>/data/default-user/extensions/chat-avatar/
├── manifest.json
├── index.js
└── style.css
```

Từ máy Windows (thay `user@vps` và đường dẫn cho đúng):

```bash
scp -r "D:/PROMPT/VPS/SILLY TAVERN/chat-avatar" user@vps:/đường/dẫn/SillyTavern/data/default-user/extensions/
```

- Nếu ST chạy bằng **Docker**, chép vào thư mục `data` được mount ra ngoài
  (thường là `./data/default-user/extensions/`).
- Nếu bật nhiều user, thay `default-user` bằng handle của user bạn dùng.
- Không cần khởi động lại server. Chỉ cần tải lại trang (F5), rồi vào **Extensions** kiểm tra
  mục **Chat Avatar** đã hiện và đang bật.

## Cách dùng

### Đặt tay
Mở chat, bấm nút **cây đũa thần** (Extensions menu), chọn **Avatar cho chat này**. Sau đó:
- **Tải ảnh lên**, kéo thả ảnh vào khung, hoặc **Ctrl+V** để dán ảnh từ clipboard.
  Sau đó hiện **khung cắt ảnh giống lúc đổi avatar gốc**: lăn chuột hoặc chụm hai ngón để zoom, kéo để chọn vùng, rồi bấm *Crop*;
- **Cắt lại**: mở khung cắt cho avatar đang dùng (với ảnh link ngoài, trang đó có thể chặn);
- hoặc dán **link ảnh** rồi bấm *Áp dụng*;
- **Dùng ảnh gốc** để bỏ avatar riêng của chat đó.

Bấm vào avatar trong chat sẽ phóng to đúng ảnh riêng.

### Lệnh (dùng được trong STscript / Quick Reply)
```
/chatavatar https://…/anh.png     → đặt bằng link
/chatavatar linh.png              → đặt bằng file trong thư mục chat-avatars
/chatavatar clear                 → dùng lại ảnh gốc
/chatavatar                       → trả về avatar hiện tại
```

### Tự động: để R21 tự chọn avatar
Khi tin nhắn của nhân vật có dòng:

```
[avatar: tên-file.png]
```
hoặc `[avatar: https://link-ảnh]`, extension tự đặt avatar đó cho chat và ẩn dòng này khỏi khung chat.
Tin nhắn mới có thẻ khác thì avatar đổi theo.

Mô hình không tự bịa được link ảnh có thật, nên cách chắc chắn nhất là dựng **thư viện ảnh**:

1. Chép sẵn ảnh vào `data/default-user/user/images/chat-avatars/` trên VPS,
   đặt tên dễ hiểu: `nu-toc-den-hoc-sinh.png`, `nam-kiem-si.png`…
   (Ảnh tải lên bằng nút *Tải ảnh lên* cũng nằm trong thư mục này.)
2. Thêm vào prompt hoặc lorebook của R21 một đoạn kiểu:

   > Khi tạo nhân vật mới, ở cuối tin nhắn đầu tiên ghi đúng một dòng `[avatar: <tên file>]`,
   > chọn file hợp ngoại hình nhân vật nhất trong danh sách sau:
   > nu-toc-den-hoc-sinh.png, nam-kiem-si.png, …

Chat cũ có sẵn thẻ `[avatar: …]` sẽ tự nhận khi mở lại, trừ khi bạn đã bấm *Dùng ảnh gốc* cho chat đó.

## Cài đặt (Extensions → Chat Avatar)
- **Bật avatar riêng cho từng chat**: tắt thì mọi chat dùng lại ảnh gốc. Dữ liệu vẫn giữ nguyên.
- **Tự nhận thẻ `[avatar: …]`**
- **Ẩn thẻ `[avatar: …]` khỏi khung chat**: chỉ ẩn khi hiển thị, nội dung tin nhắn không đổi.
- **Mở khung cắt ảnh khi tải ảnh lên** và **Tỉ lệ khung cắt**: 2:3 (giống avatar ST), 1:1 hoặc tự do.
- **Cạnh dài tối đa khi tải ảnh lên**
