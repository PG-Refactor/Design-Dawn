//! Minimal valid image headers for unit tests: enough for format detection and size probing,
//! not decodable pictures.

pub fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x0D]);
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    // 8-bit RGBA, then a CRC placeholder: the probe does not verify it.
    bytes.extend_from_slice(&[0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    bytes
}

pub fn gif_bytes(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&[0, 0, 0]);
    bytes
}

pub fn jpeg_bytes(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    bytes.extend_from_slice(b"JFIF\0");
    bytes.extend_from_slice(&[1, 1, 0, 0, 1, 0, 1, 0, 0]);
    // SOF0: length 17, precision 8, height, width, 3 components.
    bytes.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08]);
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    bytes
}

pub fn webp_bytes(width: u16, height: u16) -> Vec<u8> {
    // Lossy "VP8 " chunk with a key-frame header.
    let mut chunk = vec![0x00, 0x00, 0x00, 0x9D, 0x01, 0x2A];
    chunk.extend_from_slice(&width.to_le_bytes());
    chunk.extend_from_slice(&height.to_le_bytes());
    chunk.extend_from_slice(&[0; 4]);
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&u32::try_from(4 + 8 + chunk.len()).unwrap().to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8 ");
    bytes.extend_from_slice(&u32::try_from(chunk.len()).unwrap().to_le_bytes());
    bytes.extend_from_slice(&chunk);
    bytes
}
