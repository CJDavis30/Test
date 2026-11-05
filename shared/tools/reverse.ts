/** Reverse-image search links. The big engines take an address (URL) of a public image, so for a picture on your own disk the page says how to upload it. */
export interface RevLink { label: string; url: string; note: string }
export function reverseImageLinks(imageUrl: string): RevLink[] {
  const u = encodeURIComponent(imageUrl.trim());
  return [
    { label: 'Google Lens', url: `https://lens.google.com/uploadbyurl?url=${u}`, note: 'Best for objects, places and products' },
    { label: 'Bing Visual Search', url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${u}`, note: 'Good for finding larger copies' },
    { label: 'Yandex Images', url: `https://yandex.com/images/search?rpt=imageview&url=${u}`, note: 'Strongest for faces-in-context and Eastern Europe / Russia' },
    { label: 'TinEye', url: `https://tineye.com/search?url=${u}`, note: 'Finds exact and edited copies and when they first appeared' },
    { label: 'Baidu', url: `https://graph.baidu.com/details?isfromtusoupc=1&tn=pc&carousel=0&promotion_name=pc_image_shituindex&extUiData%5BisLogoShow%5D=1&image=${u}`, note: 'Best for Chinese-language sites' },
    { label: 'Karma Decay (Reddit)', url: `https://karmadecay.com/search?q=${u}`, note: 'Finds the picture on Reddit' },
  ];
}
export const uploadReverseLinks: RevLink[] = [
  { label: 'Google Lens (upload)', url: 'https://lens.google.com/', note: 'Drag the picture onto the page' },
  { label: 'TinEye (upload)', url: 'https://tineye.com/', note: 'Choose a file' },
  { label: 'Yandex Images (upload)', url: 'https://yandex.com/images/', note: 'Click the camera icon' },
  { label: 'Bing Visual Search (upload)', url: 'https://www.bing.com/visualsearch', note: 'Drop or browse' },
];
