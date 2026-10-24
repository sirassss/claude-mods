# claude-mods

Các mod cho Claude Code (hooks module, không cần cài package nào).

| Mod | Làm gì |
| --- | --- |
| [sudo-pane](sudo-pane/) | Khi Claude chạy lệnh có `sudo`, hiện ô nhập password ngay trên ô input. Password đi qua `SUDO_ASKPASS`, không vào lệnh hay transcript. |
| [blast-radius](blast-radius/) | Giữ lệnh rủi ro (`rm -rf`, `git reset --hard`, `git clean`, force push, migration), cho xem nó sẽ thay đổi gì, kèm nút Proceed / Cancel. |
| [replay-theater](replay-theater/) | Duyệt lại từng diff Claude đã sửa trong turn vừa rồi. |

## Cài đặt

Trong một session Claude Code ở terminal:

```
/plugin install sudo-pane --marketplace sirassss/claude-mods
/plugin install blast-radius --marketplace sirassss/claude-mods
/plugin install replay-theater --marketplace sirassss/claude-mods
```

Lần đầu trả lời `y` để thêm marketplace, rồi chọn scope (user là mặc định).

Từ shell:

```
claude plugin install sudo-pane --marketplace sirassss/claude-mods
```

Trên desktop app: bấm + cạnh ô prompt, chọn Plugins, Add marketplace với `sirassss/claude-mods`, rồi Add plugin.

## Nguồn

`blast-radius` và `replay-theater` lấy nguyên từ [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground) (Apache-2.0); phần cài đặt trong README của chúng là của repo gốc, ở đây dùng các lệnh bên trên. `sudo-pane` do sirassss viết.

Giấy phép: Apache-2.0, xem [LICENSE](LICENSE).
