import {
  Dialog,
  Plugin,
  getFrontend,
  fetchPost,
  fetchSyncPost,
  IWebSocketData,
  getAllEditor,
  openTab,
  getAllModels,
  Custom,
} from "siyuan";
import "@/index.scss";
import PluginInfoString from '@/../plugin.json';
import {
  getImageSizeFromBase64,
  locatePNGtEXt,
  insertPNGpHYs,
  replaceSubArray,
  arrayToBase64,
  base64ToArray,
  base64ToUnicode,
  unicodeToBase64,
  blobToDataURL,
  dataURLToBlob,
  HTMLToElement,
} from "./utils";
import { matchHotKey } from "./utils/hotkey";
import defaultImageContent from "@/default.json";



let PluginInfo = {
  version: '',
}
try {
  PluginInfo = PluginInfoString
} catch (err) {
  console.log('Plugin info parse error: ', err)
}
const {
  version,
} = PluginInfo

const STORAGE_NAME = "config.json";

// Type definitions
interface DrawnixImageInfo {
  blockID: string;
  imageURL: string;
  data: string; // Base64 encoded image data
  format: 'svg' | 'png';
  drawnixData?: string; // JSON string of drawnix board data
}

type SyFrontendTypes = 'desktop' | 'desktop-window' | 'mobile' | 'browser' | 'browser-desktop' | 'browser-mobile';

interface SettingItem {
  title: string;
  description?: string;
  direction?: 'row' | 'column';
  actionElement?: HTMLElement;
  createActionElement?: () => HTMLElement;
}


export default class DrawnixPlugin extends Plugin {
  // Run as mobile
  public isMobile: boolean
  // Run in browser
  public isBrowser: boolean
  // Run as local
  public isLocal: boolean
  // Run in Electron
  public isElectron: boolean
  // Run in window
  public isInWindow: boolean
  public platform: SyFrontendTypes
  public readonly version = version

  private _mutationObserver;
  private _openMenuImageHandler;
  private _globalKeyDownHandler;
  private _mouseOverHandler;
  private isMouseOverProcessing = false;

  private settingItems: SettingItem[];
  public EDIT_TAB_TYPE = "drawnix-edit-tab";

  /**
   * Push notification to SiYuan using the built-in API: /api/notification/pushMsg
   * @param msg message content
   * @param timeout display timeout in ms, default 7000
   */


  async onload() {
    this.initMetaInfo();
    this.initSetting();

    this._mutationObserver = this.setAddImageBlockMuatationObserver(document.body, (blockElement: HTMLElement) => {
      if (this.data[STORAGE_NAME].labelDisplay === "noLabel") return;

      const imageElement = blockElement.querySelector("img") as HTMLImageElement;
      if (imageElement) {
        const imageURL = imageElement.getAttribute("data-src");
        this.getDrawnixImageInfo(imageURL, blockElement).then((imageInfo) => {
          this.updateAttrLabel(imageInfo, blockElement);
        });
      }
    });

    this.setupEditTab();

    this.protyleSlash = [{
      filter: ["drawnix", "白板","思维导图"],
      id: "drawnix",
      html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">Drawnix</span></div>`,
      callback: (protyle, nodeElement) => {
        this.newDrawnixImage(protyle, nodeElement.dataset.nodeId, (imageInfo) => {
          if (!this.isMobile && this.data[STORAGE_NAME].editWindow === 'tab') {
            this.openEditTab(imageInfo);
          } else {
            this.openEditDialog(imageInfo);
          }
        });
      },
    }];

    this._openMenuImageHandler = this.openMenuImageHandler.bind(this);
    this.eventBus.on("open-menu-image", this._openMenuImageHandler);

    this._globalKeyDownHandler = this.globalKeyDownHandler.bind(this);
    document.documentElement.addEventListener("keydown", this._globalKeyDownHandler);

    this._mouseOverHandler = this.mouseOverHandler.bind(this);
    document.addEventListener("mouseover", this._mouseOverHandler);

    this.reloadAllEditor();
  }

  onunload() {
    if (this._mutationObserver) this._mutationObserver.disconnect();
    if (this._openMenuImageHandler) this.eventBus.off("open-menu-image", this._openMenuImageHandler);
    if (this._globalKeyDownHandler) document.documentElement.removeEventListener("keydown", this._globalKeyDownHandler);
    if (this._mouseOverHandler) document.removeEventListener("mouseover", this._mouseOverHandler);
    this.reloadAllEditor();
    this.removeAllDrawnixTab();
  }

  uninstall() {
    this.removeData(STORAGE_NAME);
  }

  openSetting() {
    const dialogHTML = `
<div class="b3-dialog__content"></div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel" data-type="cancel">${window.siyuan.languages.cancel}</button>
  <div class="fn__space"></div>
  <button class="b3-button b3-button--text" data-type="confirm">${window.siyuan.languages.save}</button>
</div>
    `;

    const dialog = new Dialog({
      title: this.displayName,
      content: dialogHTML,
      width: this.isMobile ? "92vw" : "768px",
      height: "80vh",
      hideCloseIcon: this.isMobile,
    });

    // 配置的处理拷贝自思源源码
    const contentElement = dialog.element.querySelector(".b3-dialog__content");
    this.settingItems.forEach((item) => {
      let html = "";
      let actionElement = item.actionElement;
      if (!item.actionElement && item.createActionElement) {
        actionElement = item.createActionElement();
      }
      const tagName = actionElement?.classList.contains("b3-switch") ? "label" : "div";
      if (typeof item.direction === "undefined") {
        item.direction = (!actionElement || "TEXTAREA" === actionElement.tagName) ? "row" : "column";
      }
      if (item.direction === "row") {
        html = `<${tagName} class="b3-label">
    <div class="fn__block">
        ${item.title}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
        <div class="fn__hr"></div>
    </div>
</${tagName}>`;
      } else {
        html = `<${tagName} class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${item.title}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
    </div>
    <span class="fn__space${actionElement ? "" : " fn__none"}"></span>
</${tagName}>`;
      }
      contentElement.insertAdjacentHTML("beforeend", html);
      if (actionElement) {
        if (["INPUT", "TEXTAREA"].includes(actionElement.tagName)) {
          dialog.bindInput(actionElement as HTMLInputElement, () => {
            (dialog.element.querySelector(".b3-dialog__action [data-type='confirm']") as HTMLElement).dispatchEvent(new CustomEvent("click"));
          });
        }
        if (item.direction === "row") {
          contentElement.lastElementChild.lastElementChild.insertAdjacentElement("beforeend", actionElement);
          actionElement.classList.add("fn__block");
        } else {
          actionElement.classList.remove("fn__block");
          actionElement.classList.add("fn__flex-center", "fn__size200");
          contentElement.lastElementChild.insertAdjacentElement("beforeend", actionElement);
        }
      }
    });

    (dialog.element.querySelector(".b3-dialog__action [data-type='cancel']") as HTMLElement).addEventListener("click", () => {
      dialog.destroy();
    });
    (dialog.element.querySelector(".b3-dialog__action [data-type='confirm']") as HTMLElement).addEventListener("click", () => {
      this.data[STORAGE_NAME].labelDisplay = (dialog.element.querySelector("[data-type='labelDisplay']") as HTMLSelectElement).value;
      this.data[STORAGE_NAME].embedImageFormat = (dialog.element.querySelector("[data-type='embedImageFormat']") as HTMLSelectElement).value;
      this.data[STORAGE_NAME].editWindow = (dialog.element.querySelector("[data-type='editWindow']") as HTMLSelectElement).value;
      this.saveData(STORAGE_NAME, this.data[STORAGE_NAME]);
      this.reloadAllEditor();
      this.removeAllDrawnixTab();
      dialog.destroy();
    });
  }

  private async initSetting() {
    await this.loadData(STORAGE_NAME);
    if (!this.data[STORAGE_NAME]) this.data[STORAGE_NAME] = {};
    if (typeof this.data[STORAGE_NAME].labelDisplay === 'undefined') this.data[STORAGE_NAME].labelDisplay = "showLabelAlways";
    if (typeof this.data[STORAGE_NAME].embedImageFormat === 'undefined') this.data[STORAGE_NAME].embedImageFormat = "svg";
    if (typeof this.data[STORAGE_NAME].editWindow === 'undefined') this.data[STORAGE_NAME].editWindow = 'tab';

    this.settingItems = [
      {
        title: this.i18n.labelDisplay,
        direction: "column",
        description: this.i18n.labelDisplayDescription,
        createActionElement: () => {
          const options = ["noLabel", "showLabelAlways", "showLabelOnHover"];
          const optionsHTML = options.map(option => {
            const isSelected = String(option) === String(this.data[STORAGE_NAME].labelDisplay);
            return `<option value="${option}"${isSelected ? " selected" : ""}>${this.i18n[option]}</option>`;
          }).join("");
          return HTMLToElement(`<select class="b3-select fn__flex-center" data-type="labelDisplay">${optionsHTML}</select>`);
        },
      },
      {
        title: this.i18n.embedImageFormat,
        direction: "column",
        description: this.i18n.embedImageFormatDescription,
        createActionElement: () => {
          const options = ["svg", "png"];
          const optionsHTML = options.map(option => {
            const isSelected = String(option) === String(this.data[STORAGE_NAME].embedImageFormat);
            return `<option value="${option}"${isSelected ? " selected" : ""}>${option}</option>`;
          }).join("");
          return HTMLToElement(`<select class="b3-select fn__flex-center" data-type="embedImageFormat">${optionsHTML}</select>`);
        },
      },
      {
        title: this.i18n.editWindow,
        direction: "column",
        description: this.i18n.editWindowDescription,
        createActionElement: () => {
          const options = ["dialog", "tab"];
          const optionsHTML = options.map(option => {
            const isSelected = String(option) === String(this.data[STORAGE_NAME].editWindow);
            return `<option value="${option}"${isSelected ? " selected" : ""}>${option}</option>`;
          }).join("");
          return HTMLToElement(`<select class="b3-select fn__flex-center" data-type="editWindow">${optionsHTML}</select>`);
        },
      },
    ];
  }

  private initMetaInfo() {
    const frontEnd = getFrontend();
    this.platform = frontEnd as SyFrontendTypes
    this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
    this.isBrowser = frontEnd.includes('browser');
    this.isLocal = location.href.includes('127.0.0.1') || location.href.includes('localhost');
    this.isInWindow = location.href.includes('window.html');

    try {
      require("@electron/remote")
        .require("@electron/remote/main");
      this.isElectron = true;
    } catch (err) {
      this.isElectron = false;
    }
  }

  public setAddImageBlockMuatationObserver(element: HTMLElement, callback: (blockElement: HTMLElement) => void): MutationObserver {
    const mutationObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const addedElement = node as HTMLElement;
              if (addedElement.matches("div[data-type='NodeParagraph']")) {
                if (addedElement.querySelector(".img[data-type='img'] img")) {
                  callback(addedElement as HTMLElement);
                }
              } else {
                addedElement.querySelectorAll("div[data-type='NodeParagraph']").forEach((blockElement: HTMLElement) => {
                  if (blockElement.querySelector(".img[data-type='img'] img")) {
                    callback(blockElement);
                  }
                })
              }
            }
          });
        }
      }
    });

    mutationObserver.observe(element, {
      childList: true,
      subtree: true
    });

    return mutationObserver;
  }

  public async getDrawnixImageInfo(imageURL: string, blockElement?: HTMLElement): Promise<DrawnixImageInfo | null> {
    const imageURLRegex = /^assets\/.+\.(?:svg|png)$/;
    if (!imageURLRegex.test(imageURL)) return null;

    let blockID = '';
    let drawnixData = '';

    if (blockElement) {
      blockID = blockElement.getAttribute("data-node-id");
      drawnixData = blockElement.getAttribute("custom-drawnix");
    } else {
      const imageElement = document.querySelector(`img[data-src="${imageURL}"]`);
      if (imageElement) {
        blockElement = imageElement.closest('[data-node-id]') as HTMLElement;
        if (blockElement) {
          blockID = blockElement.getAttribute("data-node-id");
          drawnixData = blockElement.getAttribute("custom-drawnix");
        }
      }
    }

    if (!blockID) return null;

    // If we didn't find drawnix data in DOM, try API (fallback)
    if (!drawnixData) {
      const customAttr = await this.getBlockAttrs(blockID);
      if (customAttr) {
        drawnixData = customAttr['custom-drawnix'];
      }
    }

    if (!drawnixData) return null;

    const imageContent = await this.getDrawnixImage(imageURL, true);
    if (!imageContent) return null;

    const imageInfo: DrawnixImageInfo = {
      blockID: blockID,
      imageURL: imageURL,
      data: imageContent,
      format: imageURL.endsWith(".svg") ? "svg" : "png",
      drawnixData: drawnixData,
    }
    return imageInfo;
  }

  public getPlaceholderImageContent(format: 'svg' | 'png'): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="183"><rect width="100%" height="100%" fill="#ffffff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="#888">Drawnix</text></svg>`;
    const base64 = unicodeToBase64(svg);
    if (format === 'svg') return `data:image/svg+xml;base64,${base64}`;
    // Fallback: return svg data URL even for png to ensure a valid data URL is returned
    return `data:image/svg+xml;base64,${base64}`;
  }

  public async newDrawnixImage(protyle: any, blockID: string, callback?: (imageInfo: DrawnixImageInfo) => void) {
    const format = this.data[STORAGE_NAME].embedImageFormat;
    const imageName = `drawnix-image-${window.Lute.NewNodeID()}.${format}`;
    const placeholderImageContent = this.getPlaceholderImageContent(format);
    const blob = dataURLToBlob(placeholderImageContent);
    const file = new File([blob], imageName, { type: blob.type });
    const formData = new FormData();
    formData.append('path', `data/assets/${imageName}`);
    formData.append('file', file);
    formData.append('isDir', 'false');
    await fetchSyncPost('/api/file/putFile', formData);
      const imageURL = `assets/${imageName}`;
      protyle.insert(`![](${imageURL})`);
      const defaultDrawnixData = {
        "type": "drawnix",
        "version": 1,
        "source": "web",
        "children": [

        ],
        "viewport": {
          "zoom": 0.8920378279589448,
          "origination": [
            -345.4451339703334,
            -273.8101350501055
          ]
        }
      };
      // 将初始的 drawnix 数据写入块属性，参考 mindmap 插件的实现方式
      if (blockID) {
        try {
          await fetchSyncPost('/api/attr/setBlockAttrs', { id: blockID, attrs: { 'custom-drawnix': JSON.stringify(defaultDrawnixData) } });
        } catch (err) { }
      }

      const imageInfo: DrawnixImageInfo = {
        blockID: blockID,
        imageURL: imageURL,
        data: placeholderImageContent,
        format: format,
        drawnixData: JSON.stringify(defaultDrawnixData),
      };
      if (callback) {
        callback(imageInfo);
      }
  }

  public async getDrawnixImage(imageURL: string, reload: boolean): Promise<string> {
    const response = await fetch(imageURL, { cache: reload ? 'reload' : 'default' });
    if (!response.ok) return "";
    const blob = await response.blob();
    return await blobToDataURL(blob);
  }



  // Get block attributes
  private async getBlockAttrs(blockId: string): Promise<any> {
    const result = await fetchSyncPost('/api/attr/getBlockAttrs', { id: blockId });
    return result?.data || null;
  }



  public async updateDrawnixImage(imageInfo: DrawnixImageInfo, callback?: (response: IWebSocketData) => void) {
    let imageData = imageInfo.data;
    if (!imageData || imageData.trim() === '') {
      imageData = this.getPlaceholderImageContent(imageInfo.format);
    }

    const blob = dataURLToBlob(imageData);
    const file = new File([blob], imageInfo.imageURL.split('/').pop(), { type: blob.type });
    const formData = new FormData();
    formData.append("path", 'data/' + imageInfo.imageURL);
    formData.append("file", file);
    formData.append("isDir", "false");
    const response = await fetchSyncPost("/api/file/putFile", formData);
      // Save drawnix data to block attributes
      if (imageInfo.drawnixData) {
        try {
          const parsedData = JSON.parse(imageInfo.drawnixData);
          if (parsedData.children && parsedData.children.length > 0) {
            await fetchSyncPost('/api/attr/setBlockAttrs', { id: imageInfo.blockID, attrs: { 'custom-drawnix': imageInfo.drawnixData } });
          }
        } catch (e) {
          console.error("Failed to parse drawnix data", e);
        }
      }
    if (callback) callback(response);
  }

  public updateAttrLabel(imageInfo: DrawnixImageInfo, blockElement: HTMLElement) {
    if (!imageInfo) return;

    if (this.data[STORAGE_NAME].labelDisplay === "noLabel") return;

    const attrElement = blockElement.querySelector(".protyle-attr") as HTMLDivElement;
    if (attrElement) {
      const labelHTML = `<span>Drawnix</span>`;
      let labelElement = attrElement.querySelector(".label--embed-drawnix") as HTMLDivElement;
      if (labelElement) {
        labelElement.innerHTML = labelHTML;
      } else {
        labelElement = document.createElement("div");
        labelElement.classList.add("label--embed-drawnix");
        if (this.data[STORAGE_NAME].labelDisplay === "showLabelAlways") {
          labelElement.classList.add("label--embed-drawnix--always");
        }
        labelElement.innerHTML = labelHTML;
        attrElement.prepend(labelElement);
      }
    }
  }

  private mouseOverHandler(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const imgContainer = target.closest('[data-type="img"]');
    if (!imgContainer || this.isMouseOverProcessing) return;

    this.isMouseOverProcessing = true;
    setTimeout(() => this.isMouseOverProcessing = false, 100);

    if (imgContainer.querySelector('.cst-edit-drawnix')) return;

    const blockElement = imgContainer.closest('[data-node-id]') as HTMLElement;
    if (!blockElement) return;

    // Check if it is a drawnix block
    if (!blockElement.getAttribute("custom-drawnix")) return;

    const action = imgContainer.querySelector('.protyle-action');
    if (!action) return;

    // Adjust original icon style
    const actionIcon = action.querySelector('.protyle-icon') as HTMLElement;
    if (actionIcon) {
      actionIcon.style.borderTopLeftRadius = '0';
      actionIcon.style.borderBottomLeftRadius = '0';
    }

    // Insert "Edit" button
    const editBtnHtml = `
            <span class="protyle-icon protyle-icon--only protyle-custom cst-edit-drawnix" 
                  aria-label="${this.i18n.edit || 'Edit Drawnix'}"
                  style="border-top-right-radius:0;border-bottom-right-radius:0;cursor:pointer;">
                <svg class="svg"><use xlink:href="#iconEdit"></use></svg>
            </span>`;
    action.insertAdjacentHTML('afterbegin', editBtnHtml);

    // Bind click event
    const editBtn = imgContainer.querySelector('.cst-edit-drawnix');
    editBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const imgElement = imgContainer.querySelector('img') as HTMLImageElement;
      const imageURL = imgElement?.getAttribute("data-src") || imgElement?.getAttribute("src");

      if (imageURL) {
        this.getDrawnixImageInfo(imageURL, blockElement).then((imageInfo) => {
          if (imageInfo) {
            if (!this.isMobile && this.data[STORAGE_NAME].editWindow === 'tab') {
              this.openEditTab(imageInfo);
            } else {
              this.openEditDialog(imageInfo);
            }
          }
        });
      }
    });
  }

  private openMenuImageHandler({ detail }) {
    const selectedElement = detail.element;
    const imageElement = selectedElement.querySelector("img") as HTMLImageElement;
    const imageURL = imageElement.dataset.src;
    const blockElement = imageElement.closest('[data-node-id]') as HTMLElement;
    this.getDrawnixImageInfo(imageURL, blockElement).then((imageInfo: DrawnixImageInfo) => {
      if (imageInfo) {
        window.siyuan.menus.menu.addItem({
          id: "edit-drawnix",
          icon: 'iconEdit',
          label: `编辑 Drawnix`,
          index: 1,
          click: () => {
            if (!this.isMobile && this.data[STORAGE_NAME].editWindow === 'tab') {
              this.openEditTab(imageInfo);
            } else {
              this.openEditDialog(imageInfo);
            }
          }
        });
      }
    })
  }

  private getActiveCustomTab(type: string): Custom {
    const allCustoms = getAllModels().custom;
    const activeTabElement = document.querySelector(".layout__wnd--active .item--focus");
    if (activeTabElement) {
      const tabId = activeTabElement.getAttribute("data-id");
      for (const custom of allCustoms as any[]) {
        if (custom.type == this.name + type && custom.tab.headElement?.getAttribute('data-id') == tabId) {
          return custom;
        };
      }
    }
    return null;
  }

  private tabHotKeyEventHandler = (event: KeyboardEvent, custom?: Custom) => {
    // 自定义处理方式的快捷键
    const isFullscreenHotKey = matchHotKey(window.siyuan.config.keymap.editor.general.fullscreen.custom, event);
    const isCloseTabHotKey = matchHotKey(window.siyuan.config.keymap.general.closeTab.custom, event);
    if (isFullscreenHotKey || isCloseTabHotKey) {
      if (!custom) custom = this.getActiveCustomTab(this.EDIT_TAB_TYPE);
      if (custom) {
        event.preventDefault();
        event.stopPropagation();

        if (isFullscreenHotKey) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            custom.element.requestFullscreen();
          }
        }
        if (isCloseTabHotKey) {
          custom.tab.close();
        }
      }
    }
  };

  private globalKeyDownHandler = (event: KeyboardEvent) => {
    // 如果是在代码编辑器里使用快捷键，则阻止冒泡 https://github.com/YuxinZhaozyx/siyuan-embed-tikz/issues/1
    if (document.activeElement.closest(".b3-dialog--open .drawnix-edit-dialog")) {
      event.stopPropagation();
    }

    // 快捷键
    this.tabHotKeyEventHandler(event);
  };

  public setupEditTab() {
    const that = this;
    this.addTab({
      type: this.EDIT_TAB_TYPE,
      init() {
        const imageInfo: DrawnixImageInfo = this.data;
        const editTabHTML = `
<div class="drawnix-edit-tab">
    <iframe src="/plugins/siyuan-plugin-drawnix/drawnix-embed/index.html"></iframe>
</div>`;
        this.element.innerHTML = editTabHTML;

        const iframe = this.element.querySelector("iframe");
        iframe.focus();

        const postMessage = (message: any) => {
          if (!iframe.contentWindow) return;
          iframe.contentWindow.postMessage(message, '*');
        };

        const fullscreenOnLogo = '<svg t="1763089104127" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5274" width="24" height="24"><path d="M149.333333 394.666667c17.066667 0 32-14.933333 32-32v-136.533334l187.733334 187.733334c6.4 6.4 14.933333 8.533333 23.466666 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-187.733333-187.733334H362.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H149.333333c-4.266667 0-8.533333 0-10.666666 2.133334-8.533333 4.266667-14.933333 10.666667-19.2 17.066666-2.133333 4.266667-2.133333 8.533333-2.133334 12.8v213.333334c0 17.066667 14.933333 32 32 32zM874.666667 629.333333c-17.066667 0-32 14.933333-32 32v136.533334L642.133333 597.333333c-12.8-12.8-32-12.8-44.8 0s-12.8 32 0 44.8l200.533334 200.533334H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333334c4.266667 0 8.533333 0 10.666666-2.133334 8.533333-4.266667 14.933333-8.533333 17.066667-17.066666 2.133333-4.266667 2.133333-8.533333 2.133333-10.666667V661.333333c2.133333-17.066667-12.8-32-29.866666-32zM381.866667 595.2l-200.533334 200.533333V661.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333334c0 4.266667 0 8.533333 2.133334 10.666666 4.266667 8.533333 8.533333 14.933333 17.066666 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333l200.533333-200.533333c12.8-12.8 12.8-32 0-44.8s-29.866667-10.666667-42.666666 0zM904.533333 138.666667c0-2.133333 0-2.133333 0 0-4.266667-8.533333-10.666667-14.933333-17.066666-17.066667-4.266667-2.133333-8.533333-2.133333-10.666667-2.133333H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533334l-187.733334 187.733333c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333l187.733333-187.733333V362.666667c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V149.333333c-2.133333-4.266667-2.133333-8.533333-4.266667-10.666666z" fill="#666666" p-id="5275"></path></svg>';
        const fullscreenOffLogo = '<svg t="1763089178999" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5443" width="24" height="24"><path d="M313.6 358.4H177.066667c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333333c4.266667 0 8.533333 0 10.666667-2.133333 8.533333-4.266667 14.933333-8.533333 17.066666-17.066667 2.133333-4.266667 2.133333-8.533333 2.133334-10.666667v-213.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v136.533333L172.8 125.866667c-12.8-12.8-32-12.8-44.8 0-12.8 12.8-12.8 32 0 44.8l185.6 187.733333zM695.466667 650.666667H832c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H618.666667c-4.266667 0-8.533333 0-10.666667 2.133333-8.533333 4.266667-14.933333 8.533333-17.066667 17.066667-2.133333 4.266667-2.133333 8.533333-2.133333 10.666666v213.333334c0 17.066667 14.933333 32 32 32s32-14.933333 32-32v-136.533334l200.533333 200.533334c6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-204.8-198.4zM435.2 605.866667c-4.266667-8.533333-8.533333-14.933333-17.066667-17.066667-4.266667-2.133333-8.533333-2.133333-10.666666-2.133333H192c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533333L128 851.2c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466666-8.533333l200.533334-200.533333V832c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V618.666667c-2.133333-4.266667-2.133333-8.533333-4.266667-12.8zM603.733333 403.2c4.266667 8.533333 8.533333 14.933333 17.066667 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333L896 170.666667c12.8-12.8 12.8-32 0-44.8-12.8-12.8-32-12.8-44.8 0l-187.733333 187.733333V177.066667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c2.133333 4.266667 2.133333 8.533333 4.266666 12.8z" fill="#666666" p-id="5444"></path></svg>';
        
        const switchFullscreen = () => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            this.element.requestFullscreen();
          }
        };

        // 监听全屏状态变化，更新按钮图标
        const fullscreenChangeHandler = () => {
          const fullscreenButton = iframe.contentDocument?.querySelector('.customFullscreenButton') as HTMLElement;
          if (fullscreenButton) {
            const iconDiv = fullscreenButton.querySelector('.tool-icon__icon');
            if (iconDiv) {
              iconDiv.innerHTML = document.fullscreenElement ? fullscreenOffLogo : fullscreenOnLogo;
            }
          }
        };
        document.addEventListener('fullscreenchange', fullscreenChangeHandler);

        const onInit = () => {
          let data = { children: [] };
          try {
            if (imageInfo.drawnixData) {
              data = JSON.parse(imageInfo.drawnixData);
            }
          } catch (e) {
            console.error("Failed to parse drawnix data", e);
          }
          postMessage({
            type: "init",
            data: data
          });
          
          // 等待 drawnix 工具栏渲染完成后添加全屏按钮
          let retryCount = 0;
          const maxRetries = 20;
          const addFullscreenButton = () => {
            try {
              const toolbarElement = iframe.contentDocument?.querySelector(".zoom-toolbar .stack_horizontal");
              if (toolbarElement) {
                // 创建全屏按钮,样式与drawnix工具栏按钮保持一致
                const doc = iframe.contentDocument;
                const fullscreenButton = doc.createElement('button');
                fullscreenButton.className = 'tool-icon_type_button tool-icon_size_medium customFullscreenButton tool-icon_type_button--show tool-icon';
                fullscreenButton.title = '全屏';
                fullscreenButton.setAttribute('aria-label', '全屏');
                fullscreenButton.type = 'button';
                
                const iconDiv = doc.createElement('div');
                iconDiv.className = 'tool-icon__icon';
                iconDiv.setAttribute('aria-hidden', 'true');
                iconDiv.setAttribute('aria-disabled', 'false');
                iconDiv.innerHTML = fullscreenOnLogo;
                
                fullscreenButton.appendChild(iconDiv);
                
                // 添加到工具栏最后
                toolbarElement.appendChild(fullscreenButton);
                fullscreenButton.addEventListener('click', switchFullscreen);
                
              } else if (retryCount < maxRetries) {
                retryCount++;
                setTimeout(addFullscreenButton, 100);
              } else {
                console.error('[Tab] Failed to find toolbar after max retries');
              }
            } catch (err) {
              console.error('[Tab] Error adding fullscreen button:', err);
            }
          };
          setTimeout(addFullscreenButton, 100);
        }

        const onSave = (message: any) => {
          // Drawnix 会返回保存的数据
          if (message.data) {
            imageInfo.drawnixData = JSON.stringify(message.data);
          }
          // 请求导出图片
          postMessage({
            type: 'export',
            format: imageInfo.format
          });
          // 给思源发送保存通知（仅手动保存时）
          if (message.type === 'save') {
            try {
              const msg = (window as any)?.siyuan?.languages?.allChangesSaved || '保存成功';
            } catch (err) {
              console.error('Failed to send save notification', err);
            }
          }
        }

        const onExport = (message: any) => {
          if (message.format == imageInfo.format && message.data) {
            imageInfo.data = message.data;

            that.updateDrawnixImage(imageInfo, () => {
              // 更新页面上的图片
              fetch(imageInfo.imageURL, { cache: 'reload' }).then(() => {
                document.querySelectorAll(`img[data-src='${imageInfo.imageURL}']`).forEach(imageElement => {
                  (imageElement as HTMLImageElement).src = imageInfo.imageURL;
                  const blockElement = imageElement.closest("div[data-type='NodeParagraph']") as HTMLElement;
                  if (blockElement) {
                    that.updateAttrLabel(imageInfo, blockElement);
                  }
                });
              });
            });
          }
        }

        const onExit = (message: any) => {
          this.tab.close();
        }

        const messageEventHandler = (event) => {
          // 只处理来自 iframe 的消息
          if (event.source !== iframe.contentWindow) return;

          try {
            const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (message != null) {
              // console.log('[Drawnix]', message.type);
              if (message.type == "ready") {
                onInit();
              }
              else if (message.type == "save" || message.type == "autosave") {
                onSave(message);
              }
              else if (message.type == "export") {
                onExport(message);
              }
              else if (message.type == "exit") {
                onExit(message);
              }
            }
          }
          catch (err) {
            console.error(err);
          }
        };

        const keydownEventHandleer = (event: KeyboardEvent) => {
          that.tabHotKeyEventHandler(event, this);
        };

        window.addEventListener("message", messageEventHandler);
        iframe.contentWindow.addEventListener("keydown", keydownEventHandleer);
        this.beforeDestroy = () => {
          window.removeEventListener("message", messageEventHandler);
          iframe.contentWindow.removeEventListener("keydown", keydownEventHandleer);
          document.removeEventListener('fullscreenchange', fullscreenChangeHandler);
        };
      }
    });
  }

  public openEditTab(imageInfo: DrawnixImageInfo) {
    openTab({
      app: this.app,
      custom: {
        id: this.name + this.EDIT_TAB_TYPE,
        icon: "iconEdit",
        title: `${imageInfo.imageURL.split('/').pop()}`,
        data: imageInfo,
      }
    })
  }

  public openEditDialog(imageInfo: DrawnixImageInfo) {
    const iframeID = unicodeToBase64(`drawnix-edit-dialog-${imageInfo.imageURL}`);
    const editDialogHTML = `
  <div class="drawnix-edit-dialog">
    <div class="edit-dialog-header resize__move"></div>
    <div class="edit-dialog-container">
      <div class="edit-dialog-editor">
        <iframe src="/plugins/siyuan-plugin-drawnix/drawnix-embed/index.html?iframeID=${iframeID}"></iframe>
      </div>
      <div class="fn__hr--b"></div>
    </div>
  </div>
    `;

    const dialogDestroyCallbacks = [];

    const dialog = new Dialog({
      content: editDialogHTML,
      width: this.isMobile ? "92vw" : "90vw",
      height: "80vh",
      hideCloseIcon: this.isMobile,
      destroyCallback: () => {
        dialogDestroyCallbacks.forEach(callback => callback());
      },
    });

    const iframe = dialog.element.querySelector("iframe");
    iframe.focus();

    const postMessage = (message: any) => {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage(message, '*');
    };

    const onInit = () => {
      let data = { children: [] };
      try {
        if (imageInfo.drawnixData) {
          data = JSON.parse(imageInfo.drawnixData);
        }
      } catch (e) {
        console.error("Failed to parse drawnix data", e);
      }
      postMessage({
        type: "init",
        data: data,
        autosave: 1,
        modified: 'unsavedChanges',
        title: this.isMobile ? '' : imageInfo.imageURL,
      });
      
      // 等待 drawnix 工具栏渲染完成后添加全屏按钮
      let retryCount = 0;
      const maxRetries = 20;
      const addFullscreenButton = () => {
        try {
          const toolbarElement = iframe.contentDocument?.querySelector(".zoom-toolbar .stack_horizontal");
          if (toolbarElement) {
            // 创建全屏按钮,样式与drawnix工具栏按钮保持一致
            const doc = iframe.contentDocument;
            const fullscreenButton = doc.createElement('button');
            fullscreenButton.className = 'tool-icon_type_button tool-icon_size_medium customFullscreenButton tool-icon_type_button--show tool-icon';
            fullscreenButton.title = '全屏';
            fullscreenButton.setAttribute('aria-label', '全屏');
            fullscreenButton.type = 'button';
            
            const iconDiv = doc.createElement('div');
            iconDiv.className = 'tool-icon__icon';
            iconDiv.setAttribute('aria-hidden', 'true');
            iconDiv.setAttribute('aria-disabled', 'false');
            iconDiv.innerHTML = fullscreenOnLogo;
            
            fullscreenButton.appendChild(iconDiv);
            
            // 添加到工具栏最后
            toolbarElement.appendChild(fullscreenButton);
            fullscreenButton.addEventListener('click', switchFullscreen);
            
          } else if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(addFullscreenButton, 100);
          } else {
            console.error('[Dialog] Failed to find toolbar after max retries');
          }
        } catch (err) {
          console.error('[Dialog] Error adding fullscreen button:', err);
        }
      };
      setTimeout(addFullscreenButton, 100);
    }

    let isFullscreen = false;
    let dialogContainerStyle = {
      width: "100vw",
      height: "100vh",
      maxWidth: "unset",
      maxHeight: "unset",
      top: "auto",
      left: "auto",
    };
    const fullscreenOnLogo = '<svg t="1763089104127" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5274" width="24" height="24"><path d="M149.333333 394.666667c17.066667 0 32-14.933333 32-32v-136.533334l187.733334 187.733334c6.4 6.4 14.933333 8.533333 23.466666 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-187.733333-187.733334H362.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H149.333333c-4.266667 0-8.533333 0-10.666666 2.133334-8.533333 4.266667-14.933333 10.666667-19.2 17.066666-2.133333 4.266667-2.133333 8.533333-2.133334 12.8v213.333334c0 17.066667 14.933333 32 32 32zM874.666667 629.333333c-17.066667 0-32 14.933333-32 32v136.533334L642.133333 597.333333c-12.8-12.8-32-12.8-44.8 0s-12.8 32 0 44.8l200.533334 200.533334H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333334c4.266667 0 8.533333 0 10.666666-2.133334 8.533333-4.266667 14.933333-8.533333 17.066667-17.066666 2.133333-4.266667 2.133333-8.533333 2.133333-10.666667V661.333333c2.133333-17.066667-12.8-32-29.866666-32zM381.866667 595.2l-200.533334 200.533333V661.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333334c0 4.266667 0 8.533333 2.133334 10.666666 4.266667 8.533333 8.533333 14.933333 17.066666 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333l200.533333-200.533333c12.8-12.8 12.8-32 0-44.8s-29.866667-10.666667-42.666666 0zM904.533333 138.666667c0-2.133333 0-2.133333 0 0-4.266667-8.533333-10.666667-14.933333-17.066666-17.066667-4.266667-2.133333-8.533333-2.133333-10.666667-2.133333H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533334l-187.733334 187.733333c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333l187.733333-187.733333V362.666667c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V149.333333c-2.133333-4.266667-2.133333-8.533333-4.266667-10.666666z" fill="#666666" p-id="5275"></path></svg>';
    const fullscreenOffLogo = '<svg t="1763089178999" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5443" width="24" height="24"><path d="M313.6 358.4H177.066667c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333333c4.266667 0 8.533333 0 10.666667-2.133333 8.533333-4.266667 14.933333-8.533333 17.066666-17.066667 2.133333-4.266667 2.133333-8.533333 2.133334-10.666667v-213.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v136.533333L172.8 125.866667c-12.8-12.8-32-12.8-44.8 0-12.8 12.8-12.8 32 0 44.8l185.6 187.733333zM695.466667 650.666667H832c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H618.666667c-4.266667 0-8.533333 0-10.666667 2.133333-8.533333 4.266667-14.933333 8.533333-17.066667 17.066667-2.133333 4.266667-2.133333 8.533333-2.133333 10.666666v213.333334c0 17.066667 14.933333 32 32 32s32-14.933333 32-32v-136.533334l200.533333 200.533334c6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-204.8-198.4zM435.2 605.866667c-4.266667-8.533333-8.533333-14.933333-17.066667-17.066667-4.266667-2.133333-8.533333-2.133333-10.666666-2.133333H192c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533333L128 851.2c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466666-8.533333l200.533334-200.533333V832c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V618.666667c-2.133333-4.266667-2.133333-8.533333-4.266667-12.8zM603.733333 403.2c4.266667 8.533333 8.533333 14.933333 17.066667 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333L896 170.666667c12.8-12.8 12.8-32 0-44.8-12.8-12.8-32-12.8-44.8 0l-187.733333 187.733333V177.066667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c2.133333 4.266667 2.133333 8.533333 4.266666 12.8z" fill="#666666" p-id="5444"></path></svg>';
    const switchFullscreen = () => {
      const dialogContainerElement = dialog.element.querySelector('.b3-dialog__container') as HTMLElement;
      if (dialogContainerElement) {
        isFullscreen = !isFullscreen;
        if (isFullscreen) {
          dialogContainerStyle.width = dialogContainerElement.style.width;
          dialogContainerStyle.height = dialogContainerElement.style.height;
          dialogContainerStyle.maxWidth = dialogContainerElement.style.maxWidth;
          dialogContainerStyle.maxHeight = dialogContainerElement.style.maxHeight;
          dialogContainerStyle.top = dialogContainerElement.style.top;
          dialogContainerStyle.left = dialogContainerElement.style.left;
          dialogContainerElement.style.width = "100vw";
          dialogContainerElement.style.height = "100vh";
          dialogContainerElement.style.maxWidth = "unset";
          dialogContainerElement.style.maxHeight = "unset";
          dialogContainerElement.style.top = "0";
          dialogContainerElement.style.left = "0";
        } else {
          dialogContainerElement.style.width = dialogContainerStyle.width;
          dialogContainerElement.style.height = dialogContainerStyle.height;
          dialogContainerElement.style.maxWidth = dialogContainerStyle.maxWidth;
          dialogContainerElement.style.maxHeight = dialogContainerStyle.maxHeight;
          dialogContainerElement.style.top = dialogContainerStyle.top;
          dialogContainerElement.style.left = dialogContainerStyle.left;
        }
        const fullscreenButton = iframe.contentDocument.querySelector('.customFullscreenButton') as HTMLElement;
        if (fullscreenButton) fullscreenButton.innerHTML = isFullscreen ? fullscreenOffLogo : fullscreenOnLogo;
      }
    }

    const onSave = (message: any) => {
      if (message.data) {
        imageInfo.drawnixData = JSON.stringify(message.data);
      }
      postMessage({
        type: 'export',
        format: imageInfo.format,
      });
      // 给思源发送保存通知（仅手动保存时）
      if (message.type === 'save') {
        try {
          const msg = (window as any)?.siyuan?.languages?.allChangesSaved || '保存成功';
        } catch (err) {
          console.error('Failed to send save notification', err);
        }
      }
    }

    const onExport = (message: any) => {
      if (message.format == imageInfo.format && message.data) {
        imageInfo.data = message.data;
        imageInfo.data = this.fixImageContent(imageInfo.data);

        this.updateDrawnixImage(imageInfo, () => {
          postMessage({
            action: 'status',
            messageKey: 'allChangesSaved',
            modified: false
          });
          fetch(imageInfo.imageURL, { cache: 'reload' }).then(() => {
            document.querySelectorAll(`img[data-src='${imageInfo.imageURL}']`).forEach(imageElement => {
              (imageElement as HTMLImageElement).src = imageInfo.imageURL;
              const blockElement = imageElement.closest("div[data-type='NodeParagraph']") as HTMLElement;
              if (blockElement) {
                this.updateAttrLabel(imageInfo, blockElement);
              }
            });
          });
        });
      }
    }

    const onExit = (message: any) => {
      dialog.destroy();
    }

    const messageEventHandler = (event) => {
      // Check source (optional, but good practice if we can verify iframeID)
      // if (!((event.source.location.href as string).includes(`iframeID=${iframeID}`))) return; 
      // Note: event.source.location might be restricted by cross-origin policy if domains differ, 
      // but here it's same origin (plugin). 
      // However, checking event.source against iframe.contentWindow is safer.
      if (event.source !== iframe.contentWindow) return;

      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message != null) {
          // console.log(message.type);
          if (message.type == "ready") {
            onInit();
          }
          else if (message.type == "save" || message.type == "autosave") {
            onSave(message);
          }
          else if (message.type == "export") {
            onExport(message);
          }
          else if (message.type == "exit") {
            onExit(message);
          }
        }
      }
      catch (err) {
        console.error(err);
      }
    };

    window.addEventListener("message", messageEventHandler);
    dialogDestroyCallbacks.push(() => {
      window.removeEventListener("message", messageEventHandler);
    });
  }



  public reloadAllEditor() {
    getAllEditor().forEach((protyle) => { protyle.reload(false); });
  }

  public removeAllDrawnixTab() {
    getAllModels().custom.forEach((custom: any) => {
      if (custom.type == this.name + this.EDIT_TAB_TYPE) {
        custom.tab?.close();
      }
    })
  }

  public fixImageContent(imageDataURL: string) {
    // 解决SVG CSS5的light-dark样式在部分浏览器上无效的问题
    if (imageDataURL.startsWith('data:image/svg+xml')) {
      let base64String = imageDataURL.split(',').pop();
      let svgContent = base64ToUnicode(base64String);
      const regex = /light-dark\s*\(\s*((?:[^(),]|\w+\([^)]*\))+)\s*,\s*(?:[^(),]|\w+\([^)]*\))+\s*\)/gi;
      svgContent = svgContent.replace(regex, '$1');
      base64String = unicodeToBase64(svgContent);
      imageDataURL = `data:image/svg+xml;base64,${base64String}`;
    }
    // 设置PNG DPI
    // if (imageDataURL.startsWith('data:image/png')) {
    //   let binaryArray = base64ToArray(imageDataURL.split(',').pop());
    //   binaryArray = insertPNGpHYs(binaryArray, 96 * 2);
    //   const base64String = arrayToBase64(binaryArray);
    //   imageDataURL = `data:image/png;base64,${base64String}`;
    // }
    // 当图像为空时，使用默认的占位图
    const imageSize = getImageSizeFromBase64(imageDataURL);
    if (imageSize && imageSize.width <= 1 && imageSize.height <= 1) {
      if (imageDataURL.startsWith('data:image/svg+xml;base64,')) {
        let base64String = imageDataURL.split(',').pop();
        let svgContent = base64ToUnicode(base64String);
        const svgElement = HTMLToElement(svgContent);
        if (svgElement) {
          const defaultSvgElement = HTMLToElement(base64ToUnicode(this.getPlaceholderImageContent('svg').split(',').pop()));
          defaultSvgElement.setAttribute('content', svgElement.getAttribute('content'));
          svgContent = defaultSvgElement.outerHTML;
          base64String = unicodeToBase64(svgContent);
          imageDataURL = `data:image/svg+xml;base64,${base64String}`;
        }
      }
      if (imageDataURL.startsWith('data:image/png;base64,')) {
        let binaryArray = base64ToArray(imageDataURL.split(',').pop());
        let defaultBinaryArray = base64ToArray(this.getPlaceholderImageContent('png').split(',').pop());
        const srcLocation = locatePNGtEXt(binaryArray);
        const destLocation = locatePNGtEXt(defaultBinaryArray);
        if (srcLocation && destLocation) {
          binaryArray = replaceSubArray(binaryArray, srcLocation, defaultBinaryArray, destLocation);
          const base64String = arrayToBase64(binaryArray);
          imageDataURL = `data:image/png;base64,${base64String}`;
        }
      }
    }
    return imageDataURL;
  }
}
