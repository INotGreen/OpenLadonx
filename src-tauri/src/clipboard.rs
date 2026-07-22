#[cfg(target_os = "macos")]
use std::ffi::CStr;
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::{
    ffi::c_void,
    ffi::OsString,
    os::windows::ffi::OsStringExt,
    ptr::null_mut,
};

use uuid::Uuid;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSFilenamesPboardType, NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF,
    NSTIFFPboardType,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSString};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Graphics::Gdi::BITMAPINFOHEADER,
    System::{
        DataExchange::{
            CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        },
        Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        Ole::{CF_DIB, CF_DIBV5, CF_HDROP},
    },
    UI::Shell::DragQueryFileW,
};

const PASTED_IMAGES_DIR: &str = "pasted-images";

fn pasted_images_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set.".to_string())?;
    let dir = home.join(".ladonx").join(PASTED_IMAGES_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create pasted image directory: {err}"))?;
    Ok(dir)
}

fn write_pasted_image_bytes(bytes: &[u8], extension: &str) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }
    let path = pasted_images_dir()?.join(format!("pasted-image-{}.{}", Uuid::new_v4(), extension));
    std::fs::write(&path, bytes).map_err(|err| format!("Failed to write pasted image: {err}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) async fn clipboard_file_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let pasteboard = NSPasteboard::generalPasteboard();
        let filename_type = unsafe { NSFilenamesPboardType };
        let types = NSArray::arrayWithObject(filename_type);
        let Some(_) = pasteboard.availableTypeFromArray(&types) else {
            return Ok(Vec::new());
        };
        let Some(paths) = pasteboard.propertyListForType(filename_type) else {
            return Ok(Vec::new());
        };
        let Ok(paths) = paths.downcast::<NSArray>() else {
            return Ok(Vec::new());
        };
        let result = paths
            .iter()
            .filter_map(|path| {
                let Ok(path) = path.downcast::<NSString>() else {
                    return None;
                };
                let raw = path.UTF8String();
                if raw.is_null() {
                    return None;
                }
                Some(
                    unsafe { CStr::from_ptr(raw) }
                        .to_string_lossy()
                        .into_owned(),
                )
            })
            .collect::<Vec<_>>();
        return Ok(result);
    }

    #[cfg(target_os = "windows")]
    {
        unsafe {
            if OpenClipboard(null_mut()) == 0 {
                return Ok(Vec::new());
            }

            let result = (|| {
                let clipboard_format = CF_HDROP as u32;
                if IsClipboardFormatAvailable(clipboard_format) == 0 {
                    return Ok(Vec::new());
                }
                let handle = GetClipboardData(clipboard_format);
                if handle.is_null() {
                    return Ok(Vec::new());
                }

                let count = DragQueryFileW(handle, u32::MAX, null_mut(), 0);
                let mut paths = Vec::with_capacity(count as usize);
                for index in 0..count {
                    let length = DragQueryFileW(handle, index, null_mut(), 0);
                    if length == 0 {
                        continue;
                    }
                    let mut buffer = vec![0u16; length as usize + 1];
                    let written =
                        DragQueryFileW(handle, index, buffer.as_mut_ptr(), buffer.len() as u32);
                    if written == 0 {
                        continue;
                    }
                    buffer.truncate(written as usize);
                    let path = OsString::from_wide(&buffer).to_string_lossy().into_owned();
                    if !path.is_empty() {
                        paths.push(path);
                    }
                }
                Ok(paths)
            })();

            CloseClipboard();
            return result;
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}

#[cfg(target_os = "macos")]
fn write_pasted_clipboard_image(bytes: Vec<u8>, extension: &str) -> Result<String, String> {
    write_pasted_image_bytes(&bytes, extension)
}

#[cfg(target_os = "windows")]
struct ClipboardGuard;

#[cfg(target_os = "windows")]
impl ClipboardGuard {
    fn open() -> Option<Self> {
        unsafe {
            if OpenClipboard(null_mut()) == 0 {
                return None;
            }
        }
        Some(Self)
    }
}

#[cfg(target_os = "windows")]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

#[cfg(target_os = "windows")]
struct GlobalMemoryLock {
    handle: *mut c_void,
    ptr: *const u8,
}

#[cfg(target_os = "windows")]
impl GlobalMemoryLock {
    fn lock(handle: *mut c_void) -> Option<Self> {
        unsafe {
            let ptr = GlobalLock(handle);
            if ptr.is_null() {
                return None;
            }
            Some(Self {
                handle,
                ptr: ptr.cast::<u8>(),
            })
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for GlobalMemoryLock {
    fn drop(&mut self) {
        unsafe {
            GlobalUnlock(self.handle);
        }
    }
}

#[cfg(target_os = "windows")]
fn clipboard_dib_format() -> Option<u32> {
    unsafe {
        if IsClipboardFormatAvailable(CF_DIBV5 as u32) != 0 {
            return Some(CF_DIBV5 as u32);
        }
        if IsClipboardFormatAvailable(CF_DIB as u32) != 0 {
            return Some(CF_DIB as u32);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn dib_pixels_offset(header: &BITMAPINFOHEADER) -> Option<usize> {
    let header_size = header.biSize as usize;
    if header_size < std::mem::size_of::<BITMAPINFOHEADER>() {
        return None;
    }
    let palette_entries = if header.biBitCount <= 8 {
        let colors = if header.biClrUsed > 0 {
            header.biClrUsed as usize
        } else {
            1usize.checked_shl(header.biBitCount.into())?
        };
        colors.checked_mul(4)?
    } else {
        0
    };
    let bitfields_size = if header.biCompression == 3 && header_size == 40 {
        12
    } else {
        0
    };
    header_size
        .checked_add(palette_entries)?
        .checked_add(bitfields_size)
}

#[cfg(target_os = "windows")]
fn dib_to_rgba(dib: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if dib.len() < std::mem::size_of::<BITMAPINFOHEADER>() {
        return None;
    }
    let header = unsafe { &*(dib.as_ptr().cast::<BITMAPINFOHEADER>()) };
    let width = header.biWidth;
    let raw_height = header.biHeight;
    if width <= 0 || raw_height == 0 || header.biPlanes != 1 {
        return None;
    }
    if !matches!(header.biCompression, 0 | 3) {
        return None;
    }
    let bits_per_pixel = header.biBitCount as usize;
    if !matches!(bits_per_pixel, 24 | 32) {
        return None;
    }
    let width = width as usize;
    let height = raw_height.unsigned_abs() as usize;
    let top_down = raw_height < 0;
    let stride = width
        .checked_mul(bits_per_pixel)?
        .checked_add(31)?
        .checked_div(32)?
        .checked_mul(4)?;
    let pixels_offset = dib_pixels_offset(header)?;
    let pixels_len = stride.checked_mul(height)?;
    let pixels_end = pixels_offset.checked_add(pixels_len)?;
    if pixels_end > dib.len() {
        return None;
    }

    let source = &dib[pixels_offset..pixels_end];
    let mut rgba = vec![0u8; width.checked_mul(height)?.checked_mul(4)?];
    for y in 0..height {
        let source_y = if top_down { y } else { height - 1 - y };
        let row = &source[(source_y * stride)..((source_y + 1) * stride)];
        for x in 0..width {
            let source_index = x * bits_per_pixel / 8;
            let target_index = (y * width + x) * 4;
            rgba[target_index] = row[source_index + 2];
            rgba[target_index + 1] = row[source_index + 1];
            rgba[target_index + 2] = row[source_index];
            rgba[target_index + 3] = if bits_per_pixel == 32 {
                row[source_index + 3]
            } else {
                255
            };
        }
    }
    if bits_per_pixel == 32 && !rgba.chunks_exact(4).any(|pixel| pixel[3] != 0) {
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }
    Some((width as u32, height as u32, rgba))
}

#[cfg(target_os = "windows")]
fn save_windows_clipboard_dib(format: u32) -> Result<Option<String>, String> {
    unsafe {
        let handle = GetClipboardData(format);
        if handle.is_null() {
            return Ok(None);
        }
        let size = GlobalSize(handle);
        if size == 0 {
            return Ok(None);
        }
        let Some(lock) = GlobalMemoryLock::lock(handle) else {
            return Ok(None);
        };
        let dib = std::slice::from_raw_parts(lock.ptr, size);
        let Some((width, height, rgba)) = dib_to_rgba(dib) else {
            return Ok(None);
        };
        let image = image::RgbaImage::from_raw(width, height, rgba)
            .ok_or_else(|| "Failed to build clipboard image buffer.".to_string())?;
        let path = pasted_images_dir()?.join(format!("pasted-image-{}.png", Uuid::new_v4()));
        image
            .save_with_format(&path, image::ImageFormat::Png)
            .map_err(|err| format!("Failed to encode clipboard image: {err}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
}

#[tauri::command]
pub(crate) fn clipboard_image_path() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let pasteboard = NSPasteboard::generalPasteboard();
        let image_types = [
            (unsafe { NSPasteboardTypePNG }, "png"),
            (unsafe { NSPasteboardTypeTIFF }, "tiff"),
            (unsafe { NSTIFFPboardType }, "tiff"),
        ];
        let available_types = NSArray::from_slice(
            &image_types
                .iter()
                .map(|(pasteboard_type, _)| *pasteboard_type)
                .collect::<Vec<_>>(),
        );
        let Some(available_type) = pasteboard.availableTypeFromArray(&available_types) else {
            return Ok(None);
        };

        for (pasteboard_type, extension) in image_types {
            if !available_type.isEqualToString(pasteboard_type) {
                continue;
            }
            let Some(data) = pasteboard.dataForType(pasteboard_type) else {
                return Ok(None);
            };
            let path = write_pasted_clipboard_image(data.to_vec(), extension)?;
            return Ok((!path.is_empty()).then_some(path));
        }

        Ok(None)
    }

    #[cfg(target_os = "windows")]
    {
        let Some(_guard) = ClipboardGuard::open() else {
            return Ok(None);
        };
        let Some(format) = clipboard_dib_format() else {
            return Ok(None);
        };
        save_windows_clipboard_dib(format)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}
