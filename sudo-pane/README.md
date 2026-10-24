# sudo-pane

Mod cho Claude Code: khi Claude chạy một lệnh Bash có `sudo`, mod giữ lệnh lại và hiện ô nhập password ngay trên ô input. Không phải mở terminal khác để tự chạy lệnh, và Claude vẫn đọc được output.

```
🔒 Claude cần sudo  ·  bấm ctrl+x tab để nhập, Esc để ra
Lệnh  sudo apt update
Password ••••••
[Huỷ]  Password không vào transcript; nhớ 15 phút trong phiên này.
```

## Cách dùng

1. Claude gọi lệnh có `sudo`, dải nhập hiện trên ô input.
2. Bấm `ctrl+x tab` (hoặc click) để vào ô Password, gõ rồi Enter.
3. Sai password thì dải báo và cho nhập lại. Huỷ, Esc khi đang chờ, hoặc 5 phút không trả lời thì lệnh không chạy và Claude được báo.

Nếu `sudo -n true` chạy được (NOPASSWD), mod không hỏi.

## Cách hoạt động

- Password được kiểm bằng `sudo -k -S -v` (đưa qua stdin, không qua argv).
- Password được ghi vào `$XDG_RUNTIME_DIR/sudo-pane-<uid>/pw` (tmpfs, thư mục 0700, file 0600). Lệnh chạy bằng Bash tool như thường, chỉ thêm `export SUDO_ASKPASS=…/askpass` ở đầu; sudo không có tty sẽ tự gọi askpass để đọc file đó.
- File password bị xoá ngay khi lệnh xong (lệnh chạy nền: sau 60 giây).
- Mod nhớ password trong bộ nhớ 15 phút như timestamp của sudo. Đặt `REMEMBER_MS = 0` trong `hooks/register.tsx` để lần nào cũng hỏi.
- Ô nhập được vẽ lại bằng `•` sau mỗi phím; gõ được bằng bộ gõ tiếng Việt (Telex/VNI).
- Dải trên ô input chỉ một mod dùng được mỗi lúc. Nếu mod khác (như replay-theater) đang chiếm, sau 1 giây sudo-pane mở pane riêng để nhập; pane tự nhận bàn phím.

## Giới hạn

- Chỉ bắt lệnh do Claude gọi qua Bash tool. Lệnh gõ bằng `!` ở prompt không đi qua mod.
- Không dùng cho lệnh cần tty tương tác (`sudo -i`, `sudo vim`).
- Cần sudo đọc được `SUDO_ASKPASS` khi không có tty (sudo 1.9 trên Linux).

## Test

```
claude plugin test ./sudo-pane
```
