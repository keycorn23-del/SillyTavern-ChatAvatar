# Chat Avatar: mỗi chat một avatar và tên riêng

Extension cho SillyTavern. Dùng một thẻ nhân vật (ví dụ hệ thống R21) cho nhiều chat,
và mỗi chat hiện một avatar và một tên khác nhau.

- Avatar và tên được lưu trong **file chat** (`chat_metadata.chat_avatar`), nên chuyển chat là đổi theo.
  Branch hay backup chat cũng giữ nguyên.
- **Tên chỉ đổi phần hiển thị.** Tên thẻ và `{{char}}` gửi cho mô hình vẫn là tên gốc của thẻ.
- Ảnh tải lên được cắt theo khung 2:3 như avatar gốc, thu về cạnh dài 768px, rồi lưu vào
  `data/<user>/user/images/chat-avatars/` trên VPS.
- Avatar và tên riêng hiện ở: tin nhắn của nhân vật trong khung chat, và danh sách **Chat gần đây** ở màn hình chào.
  Danh sách **lịch sử chat** (Manage chat files) hiện avatar riêng (danh sách này không hiện tên nhân vật).
  Ảnh và tên thẻ trong danh sách nhân vật vẫn giữ nguyên.
- Hai danh sách chat đọc từ một bảng tra lưu trong cài đặt của extension (nằm trên server, đồng bộ giữa các máy).
  Chat nào đã đặt từ trước khi cập nhật thì mở chat đó một lần là danh sách cập nhật.
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
- Không cần khởi động lại server, chỉ cần tải lại trang (F5).

## Cách dùng

### Đặt tay
Mở chat, bấm nút **cây đũa thần** (Extensions menu), chọn **Avatar & tên cho chat này**. Sau đó:
- **Tên**: gõ tên vào ô tên rồi bấm *Lưu tên* hoặc Enter. Để trống rồi lưu là dùng lại tên gốc của thẻ.
- **Tải ảnh lên**, kéo thả ảnh vào khung, hoặc **Ctrl+V** để dán ảnh từ clipboard.
  Sau đó hiện **khung cắt ảnh giống lúc đổi avatar gốc**: lăn chuột hoặc chụm hai ngón để zoom, kéo để chọn vùng, rồi bấm *Crop*.
- **Cắt lại**: mở khung cắt cho avatar đang dùng (với ảnh link ngoài, trang đó có thể chặn).
- Hoặc dán **link ảnh** rồi bấm *Áp dụng*.
- **Dùng ảnh gốc của thẻ** để bỏ avatar riêng của chat đó.

Bấm vào avatar trong chat sẽ phóng to đúng ảnh riêng.

### Lệnh (dùng được trong STscript / Quick Reply)
```
/chatavatar https://…/anh.png     → đặt avatar bằng link
/chatavatar linh.png              → đặt avatar bằng file trong thư mục chat-avatars
/chatavatar clear                 → dùng lại ảnh gốc
/chatname Lâm Thanh Hà            → đặt tên hiển thị
/chatname clear                   → dùng lại tên gốc
/chatavatar  hoặc  /chatname      → trả về giá trị hiện tại
```

### Tự động: để R21 tự đặt avatar và tên
Khi tin nhắn của nhân vật có các dòng:

```
[name: Lâm Thanh Hà]
[avatar: tên-file.png]
```
(hoặc `[avatar: https://link-ảnh]`), extension tự đặt tên và avatar đó cho chat, rồi ẩn các dòng này khỏi khung chat.
Tin nhắn mới có thẻ khác thì đổi theo.

Mô hình không tự bịa được link ảnh có thật, nên với avatar, cách chắc chắn nhất là dựng **thư viện ảnh**:

1. Chép sẵn ảnh vào `data/default-user/user/images/chat-avatars/` trên VPS,
   đặt tên dễ hiểu: `nu-toc-den-hoc-sinh.png`, `nam-kiem-si.png`…
   (Ảnh tải lên bằng nút *Tải ảnh lên* cũng nằm trong thư mục này.)
2. Thêm vào prompt hoặc lorebook của R21 một đoạn kiểu:

   > Khi tạo nhân vật mới, ở cuối tin nhắn đầu tiên ghi đúng hai dòng:
   > `[name: <họ tên nhân vật>]`
   > `[avatar: <tên file>]`, chọn file hợp ngoại hình nhân vật nhất trong danh sách sau:
   > nu-toc-den-hoc-sinh.png, nam-kiem-si.png, …

Chat cũ có sẵn thẻ sẽ tự nhận khi mở lại, trừ khi bạn đã chỉnh tay avatar hoặc tên cho chat đó.
Thẻ chỉ bị ẩn khi hiển thị, nội dung tin nhắn không đổi.

Extension không có bảng cài đặt.
