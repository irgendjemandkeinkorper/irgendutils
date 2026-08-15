import struct
from typing import Tuple, Optional

def get_image_dimensions(filepath: str) -> Optional[Tuple[int, int]]:
    """
    Reads the header of a PNG, JPEG, GIF, or WebP file to determine its dimensions
    without loading the whole image or using external libraries.
    Returns (width, height) or None if format is unsupported/invalid.
    """
    try:
        with open(filepath, 'rb') as f:
            header = f.read(32)
            if not header:
                return None

            # --- PNG ---
            if header.startswith(b'\x89PNG\r\n\x1a\n'):
                # IHDR is typically at offset 12, size is 13 bytes, ends with CRC
                # Read 4 bytes for length, 4 bytes for chunk type 'IHDR'
                # If chunk type matches, we extract width and height.
                f.seek(12)
                chunk_type = f.read(4)
                if chunk_type == b'IHDR':
                    data = f.read(8)
                    width, height = struct.unpack('>II', data)
                    return width, height
                return None

            # --- GIF ---
            elif header.startswith(b'GIF87a') or header.startswith(b'GIF89a'):
                if len(header) >= 10:
                    width, height = struct.unpack('<HH', header[6:10])
                    return width, height
                return None

            # --- WebP ---
            elif header.startswith(b'RIFF') and header[8:12] == b'WEBP':
                # Seek to chunk type
                f.seek(12)
                chunk_id = f.read(4)
                chunk_size_bytes = f.read(4)
                if len(chunk_size_bytes) < 4:
                    return None
                chunk_size = struct.unpack('<I', chunk_size_bytes)[0]

                if chunk_id == b'VP8 ':
                    # Lossy WebP
                    f.seek(20)
                    frame_tag = f.read(3)
                    sync_code = f.read(3)
                    if sync_code == b'\x9d\x01\x2a':
                        wh_data = f.read(4)
                        if len(wh_data) == 4:
                            # Width and height are 16-bit little-endian (with top 2 bits ignored)
                            width = struct.unpack('<H', wh_data[0:2])[0] & 0x3FFF
                            height = struct.unpack('<H', wh_data[2:4])[0] & 0x3FFF
                            return width, height
                elif chunk_id == b'VP8L':
                    # Lossless WebP
                    # Signature byte is at offset 20. Must be 0x2f
                    f.seek(20)
                    sig = f.read(1)
                    if sig == b'\x2f':
                        data = f.read(4)
                        if len(data) == 4:
                            # Width: 14 bits, Height: 14 bits
                            # Byte layout in little-endian bitstream
                            b0, b1, b2, b3 = data
                            width = (b0 | ((b1 & 0x3f) << 8)) + 1
                            height = (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1
                            return width, height
                elif chunk_id == b'VP8X':
                    # Extended WebP
                    f.seek(24)
                    w_bytes = f.read(3)
                    h_bytes = f.read(3)
                    if len(w_bytes) == 3 and len(h_bytes) == 3:
                        width = struct.unpack('<I', w_bytes + b'\x00')[0] + 1
                        height = struct.unpack('<I', h_bytes + b'\x00')[0] + 1
                        return width, height
                return None

            # --- JPEG ---
            elif header.startswith(b'\xff\xd8'):
                # JPEG format
                # We start reading markers
                f.seek(2)
                while True:
                    marker_header = f.read(2)
                    if len(marker_header) < 2:
                        break
                    # All markers start with 0xFF
                    if marker_header[0] != 0xff:
                        # Scan forward for a 0xff
                        while len(marker_header) == 2 and marker_header[0] != 0xff:
                            marker_header = marker_header[1:] + f.read(1)
                        if marker_header[0] != 0xff:
                            break

                    marker = marker_header[1]
                    if marker == 0xd9:  # EOI
                        break
                    elif marker == 0x00:  # stuffed byte
                        continue
                    elif marker in (0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8):
                        # RSTx, SOI, etc. (no length)
                        continue

                    # Read length
                    len_bytes = f.read(2)
                    if len(len_bytes) < 2:
                        break
                    length = struct.unpack('>H', len_bytes)[0]

                    # SOFn markers (Start of Frame):
                    # 0xC0 to 0xC3, 0xC5 to 0xC7, 0xC9 to 0xCB, 0xCD to 0xCF
                    # 0xC4 is DHT (Define Huffman Table)
                    if (0xc0 <= marker <= 0xcf) and marker != 0xc4 and marker != 0xcc:
                        # SOFn chunk contains:
                        # 1 byte precision
                        # 2 bytes height
                        # 2 bytes width
                        data = f.read(5)
                        if len(data) == 5:
                            height, width = struct.unpack('>HH', data[1:5])
                            return width, height
                        break
                    else:
                        # Skip this chunk's payload
                        # Length includes the 2 bytes of the length field itself
                        if length > 2:
                            f.seek(length - 2, 1)
                return None

    except Exception:
        return None
    return None
