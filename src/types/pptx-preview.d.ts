declare module 'pptx-preview' {
  interface PreviewerOptionsType {
    width?: number;
    [key: string]: any;
  }

  interface PPTXPreviewer {
    preview: (source: ArrayBuffer) => Promise<unknown>;
    destroy: () => void;
  }

  export function init(dom: HTMLElement, options: PreviewerOptionsType): PPTXPreviewer;
}
