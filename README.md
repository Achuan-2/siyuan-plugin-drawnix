## 📖 使用

输入 `/drawnix`​或`/白板`​或`/思维导图`，会自动创建图片并打开 Drawnix 进行创作，编辑完成后，按Ctrl+S会自动保存为图片格式（SVG/PNG），支持二次编辑。

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/image-20251204211359-0dgyxrh.png" />

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/image-20251204211409-2d50k32.png" />

> ⚠️ 使用注意：目前图片支持二次编辑是通过自定义块属性写入drawnix数据实现的，如果自定义块属性被删除或者修改，可能会导致数据丢失，无法二次编辑。

## ⚙️ 插件设置概览

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/image-20251204212438-8ywm730.png" />

## 📦 开发

如何打包插件：

```bash
pnpm run prepare:drawnix
pnpm build
```

## ❤️致谢

- [drawnix](https://github.com/plait-board/drawnix)
- 参考了[YuxinZhaozyx](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw)嵌入式系列插件的设计

## ❤️用爱发电

如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。

维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，

我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现，我没实现的功能欢迎有大佬来pr

累积赞赏50元的朋友如果想加我微信，可以在赞赏的时候备注微信号，或者发邮件到achuan-2@outlook.com来进行好友申请

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/network-asset-network-asset-image-20250614123558-fuhir5v.png" />
