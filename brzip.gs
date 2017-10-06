/*
 * .br compression utility
 * Copyright (C) 2017  Matija Skala <mskala@gmx.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

uses Brotli

input_buffer: uint8[0x10000]
output_buffer: uint8[0x10000]

def private calculate_checksums (buffer: uint8*, len: size_t, ref xxh32: XXH32.State?, ref xxh64: XXH64.State?, ref crc32: uint32): bool
	xxh32.update (buffer, len)
	xxh64.update (buffer, len)
	crc32 = crc32c (crc32, buffer, len)
	return true

[CCode (cname = "BRP_compress")]
def compress (fin: FileStream, fout: FileStream, quality: uint32): int
	var
		is_eof = false
		compress_failed = true
		encoder = new Encoder ()
	datalen: size_t = 0
	offset: size_t = 0
	check_type: short = 3
	available_in: size_t = 0
	available_out: size_t = output_buffer.length
	next_in: uint8* = null
	next_out: uint8* = output_buffer
	xxh32state: XXH32.State = null
	xxh64state: XXH64.State = null
	if encoder != null
		case check_type
			when 3
				xxh64state = new XXH64.State ()
				xxh64state.reset ()
		compress_failed = false
		encoder.setParameter (Encoder.Parameter.QUALITY, quality)
		fout.putc (((0x34cb00 >> ((check_type ^ (check_type >> 4)) & 0xf)) & 0x80) | check_type)
		offset++
		do
			if available_in == 0 and not is_eof
				available_in = fin.read (input_buffer)
				next_in = input_buffer
				if fin.error () != 0
					stderr.printf ("Failed to read input: %m\n")
					return 1
				is_eof = fin.eof ()
				datalen += available_in
				case check_type
					when 3 do xxh64state.update (next_in, available_in)
			if not encoder.compressStream (is_eof ? Encoder.Operation.FINISH : Encoder.Operation.PROCESS, ref available_in, ref next_in, ref available_out, ref next_out, null)
				compress_failed = true
				break
			if available_out != output_buffer.length
				output: unowned array of uint8 = output_buffer
				output.length -= (int)available_out
				if fout.write (output) == 0
					stderr.printf ("Failed to write output: %m\n")
					return 1
				available_out = output_buffer.length
				next_out = output_buffer
				offset += output.length
		while not encoder.isFinished ()
	if compress_failed
		stderr.printf ("Failed to compress data\n")
		return 1
	case check_type
		when 0,1,2,3
			var xxhsum = check_type == 3 ? xxh64state.digest () : xxh32state.digest ()
			for var i = 0 to ((1 << check_type) - 1)
				fout.putc ((int8)xxhsum)
				xxhsum >>= 8
				offset++
	if offset < 0 or datalen < 0
		fout.putc (0x27)
		return 0
	fout.putc (077)
	fout.putc ((int8)offset | 0x80)
	while (offset >>= 7) > 0x7f do fout.putc ((int8)offset & 0x7f)
	fout.putc ((int8)offset | 0x80)
	fout.putc ((int8)datalen | 0x80)
	while (datalen >>= 7) > 0x7f do fout.putc ((int8)datalen & 0x7f)
	fout.putc ((int8)datalen | 0x80)
	fout.putc (077)
	return 0

[CCode (cname = "BRP_decompress")]
def decompress (fin: FileStream, fout: FileStream): int
	var
		result = Decoder.Result.SUCCESS
		decoder = new Decoder ()
		hasdatalen = false
		break_loop = false
		brv3 = false
		xxh32full = new XXH32.State ()
		xxh64full = new XXH64.State ()
		crc32full = crc32c (0, null, 0)
	if decoder == null
		stderr.printf ("Failed to decompress data\n")
		return 1
	datalen: size_t = 0
	offset: size_t = -1
	prev_datalen: size_t = 0
	check_type: short = -1
	available_in: size_t = 0
	available_out: size_t = output_buffer.length
	next_in: uint8* = null
	next_out: uint8* = output_buffer
	xxh32state: XXH32.State = null
	xxh64state: XXH64.State = null
	checksum: Checksum = null
	crc32sum: uint32 = 0
	xxh32full.reset ()
	xxh64full.reset ()
	while true
		case result
			when Decoder.Result.SUCCESS
				if fin.eof () and available_in == 0 do break_loop = true
				else
					if next_in == null do available_in = fin.read (input_buffer)
					if fin.eof () and available_in == 0 and not brv3 do break_loop = true
					else if next_in == null and available_in > 4 and Memory.cmp (input_buffer, "\xce\xb2\xcf\x81", 4) == 0
						brv3 = true
						available_in -= 4
						next_in = input_buffer + 4
						continue
					else if brv3
						if available_in == 0
							available_in = fin.read (input_buffer)
							next_in = input_buffer
							if fin.eof () do return 2
							if fin.error () != 0
								stderr.printf ("Failed to read input: %m\n")
								return 1
						if check_type >= 0
							if next_out != output_buffer
								output: unowned array of uint8 = output_buffer
								output.length -= (int)available_out
								fout.write (output)
								case check_type
									when 0,1,2 do xxh32state.update (output, output.length)
									when 3 do xxh64state.update (output, output.length)
									when 4,5,6 do crc32sum = crc32c (crc32sum, output, output.length)
									when 7
										if checksum == null
											stderr.printf ("Internal error!\n")
											return 1
										checksum.update (output, output.length)
								available_out = output_buffer.length
								next_out = output_buffer
							if hasdatalen
								offset++
								available_in--
								next_in++
								if available_in == 0
									available_in = fin.read (input_buffer)
									next_in = input_buffer
									if fin.eof () do return 2
									if fin.error () != 0
										stderr.printf ("Failed to read input: %m\n")
										return 1
								if (next_in[0] & 0x80) != 0
									stderr.printf ("Corrupt input\n")
									return 1
								num: uint64 = next_in[0] & 0x7f
								for var i = 1 to 5
									offset++
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
									if i > 4 or i == 4 and (next_in[0] & 0xf0) != 0x80
										stderr.printf ("Corrupt input\n")
										return 1
									num |= (next_in[0] & 0x7f) << (7*i)
									if (next_in[0] & 0x80) != 0 do break
								if num != datalen - prev_datalen
									stderr.printf ("Incorrect data length\n")
									return 1
							case check_type
								when 0,1,2,3
									var digest = new array of uint8[1 << check_type]
									var xxhsum = check_type == 3 ? xxh64state.digest () : xxh32state.digest ()
									for var i = 0 to (digest.length - 1)
										digest[i] = (uint8)(xxhsum >> (i * 8))
										if digest[i] != next_in[0]
											stderr.printf ("Invalid checksum!\n")
											return 1
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
									calculate_checksums (digest, digest.length, ref xxh32full, ref xxh64full, ref crc32full)
									xxh32state = null
									xxh64state = null
								when 4,5,6
									var digest = new array of uint8[1 << (check_type - 4)]
									for var i = 0 to (digest.length - 1)
										digest[i] = (uint8)(crc32sum >> (i * 8))
										if digest[i] != next_in[0]
											stderr.printf ("Invalid checksum!\n")
											return 1
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
									calculate_checksums (digest, digest.length, ref xxh32full, ref xxh64full, ref crc32full)
									crc32sum = 0
								when 7
									if checksum == null
										stderr.printf ("Internal error!\n")
										return 1
									var
										buffer1 = new array of uint8[32]
										buffer2 = new array of uint8[32]
									l: size_t = 32
									checksum.get_digest (buffer1, ref l)
									calculate_checksums (buffer1, l, ref xxh32full, ref xxh64full, ref crc32full)
									if available_in < 32
										Memory.copy (buffer2, next_in, available_in)
										var available_in_prev = (int)available_in
										available_in = fin.read (input_buffer)
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
										Memory.copy ((uint8*)buffer2 + available_in_prev, input_buffer, 32 - available_in_prev)
										available_in -= 32 - available_in_prev
										next_in = input_buffer + (32 - available_in_prev)
									else
										Memory.copy (buffer2, next_in, 32)
									if Memory.cmp (buffer1, buffer2, 32) != 0
										stderr.printf ("Invalid checksum!\n")
										return 1
									offset += 32
									available_in -= 32
									next_in += 32
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
									checksum = null
							check_type = -1
						mask: uint8 = next_in[0] & 0x7f
						if (((0x34cb00 >> ((mask ^ (mask >> 4)) & 0xf)) ^ next_in[0]) & 0x80) != 0
							stderr.printf ("Wrong parity\n")
							return 1
						if (mask & 0x60) == 0x20
							if (mask & 030) != 0 or (mask & 7) != 7
								if (mask & 020) != 0
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
									if (next_in[0] & 0x80) == 0
										stderr.printf ("Corrupt trailer\n")
										return 1
									num: uint64 = next_in[0] & 0x7f
									for var i = 1 to 5
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
										if i > 4 or i == 4 and (next_in[0] & 0xf0) != 0x80
											stderr.printf ("Corrupt trailer\n")
											return 1
										num |= (next_in[0] & 0x7f) << (7*i)
										if (next_in[0] & 0x80) != 0 do break
									if num != offset
										stderr.printf ("Incorrect header offset\n")
										return 1
								if (mask & 010) != 0
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
									if (next_in[0] & 0x80) == 0
										stderr.printf ("Corrupt trailer\n")
										return 1
									num: uint64 = next_in[0] & 0x7f
									for var i = 1 to 5
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
										if i > 4 or i == 4 and (next_in[0] & 0xf0) != 0x80
											stderr.printf ("Corrupt trailer\n")
											return 1
										num |= (next_in[0] & 0x7f) << (7*i)
										if (next_in[0] & 0x80) != 0 do break
									if num != datalen
										stderr.printf ("Incorrect data length\n")
										return 1
								available_in--
								next_in++
								if available_in == 0
									available_in = fin.read (input_buffer)
									next_in = input_buffer
									if fin.eof () do return 2
									if fin.error () != 0
										stderr.printf ("Failed to read input: %m\n")
										return 1
								case mask & 7
									when 0,1,2,3
										var xxhfull = (mask & 7) == 3 ? xxh64full.digest () : xxh32full.digest ()
										for var i = 0 to ((1 << (mask & 7)) - 1)
											if ((xxhfull >> (i * 8)) & 0xff) != next_in[0]
												stderr.printf ("Invalid checksum!\n")
												return 1
											available_in--
											next_in++
											if available_in == 0
												available_in = fin.read (input_buffer)
												next_in = input_buffer
												if fin.eof () do return 2
												if fin.error () != 0
													stderr.printf ("Failed to read input: %m\n")
													return 1
									when 4,5,6 do for var i = 0 to ((1 << ((mask & 7) - 4)) - 1)
										if ((crc32full >> (i * 8)) & 0xff) != next_in[0]
											stderr.printf ("Invalid checksum!\n")
											return 1
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
								if (next_in[0] & 0x7f) != mask
									stderr.printf ("Corrupt trailer\n")
									return 1
								if (((0x34cb00 >> ((mask ^ (mask >> 4)) & 0xf)) ^ next_in[0]) & 0x80) != 0
									stderr.printf ("Wrong parity\n")
									return 1
							available_in--
							next_in++
							if available_in == 0
								available_in = fin.read (input_buffer)
								next_in = input_buffer
								if fin.error () != 0
									stderr.printf ("Failed to read input: %m\n")
									return 1
							while not fin.eof ()
								if next_in[0] != 0
									stderr.printf ("Corrupt input: %m\n")
									return 1
								available_in--
								next_in++
								if available_in == 0
									available_in = fin.read (input_buffer)
									next_in = input_buffer
									if fin.error () != 0
										stderr.printf ("Failed to read input: %m\n")
										return 1
							break_loop = true
						else if (mask & 040) != 0
							stderr.printf ("Corrupt trailer\n")
							return 1
						else if (mask & 020) != 0 and ~offset == 0
							stderr.printf ("Corrupt input\n")
							return 1
						else
							var cur_offset = offset
							var first_header = ~offset == 0
							offset++
							available_in--
							next_in++
							if available_in == 0
								available_in = fin.read (input_buffer)
								next_in = input_buffer
								if fin.eof () do return 2
								if fin.error () != 0
									stderr.printf ("Failed to read input: %m\n")
									return 1
							hasdatalen = (mask & 8) == 8
							if (mask & 0x10) == 0x10
								num: uint64 = 0
								for var i = 0 to 5
									num |= (next_in[0] & 0x7f) << (7*i)
									var prev = next_in[0]
									offset++
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
									if (prev & 0x80) != 0 do break
									if i > 4 or i == 4 and (next_in[0] & 0xf0) != 0x80
										stderr.printf ("Corrupt header\n")
										return 1
								if num != cur_offset
									stderr.printf ("Incorrect header offset\n")
									return 1
							case mask & 7
								when 0,1,2
									check_type = mask & 7
									xxh32state = new XXH32.State ()
									xxh32state.reset ()
								when 3
									check_type = mask & 7
									xxh64state = new XXH64.State ()
									xxh64state.reset ()
								when 4,5,6
									check_type = mask & 7
									crc32sum = crc32c (0, null, 0)
								when 7
									if next_in[0] != 0
										stderr.printf ("Unknown check ID\n")
										return 1
									check_type = next_in[0] + 7
									checksum = new Checksum (ChecksumType.SHA256)
									offset++
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
							if (mask & 0x40) == 0x40
								mask = next_in[0] & 0x7f
								if (((0x34cb00 >> ((mask ^ (mask >> 4)) & 0xf)) ^ next_in[0]) & 0x80) != 0
									stderr.printf ("Wrong parity\n")
									return 1
								offset++
								available_in--
								next_in++
								if available_in == 0
									available_in = fin.read (input_buffer)
									next_in = input_buffer
									if fin.eof () do return 2
									if fin.error () != 0
										stderr.printf ("Failed to read input: %m\n")
										return 1
								if (mask & 0x18) != 0
									stderr.printf ("Unsupported field")
									return 1
								if (mask & 1) != 0
									if not first_header
										stderr.printf ("Corrupt header\n")
									while (next_in[0] & 0x80) == 0
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
									offset++
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
								if (mask & 2) != 0
									num: uint64 = 0
									for var i = 0 to 5
										num |= (next_in[0] & 0x7f) << (7*i)
										var prev = next_in[0]
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
										if (prev & 0x80) != 0 do break
										if i > 4 or i == 4 and (next_in[0] & 0xf0) != 0x80
											stderr.printf ("Corrupt metadata\n")
											return 1
									var filename = new array of char[num + 1]
									filename[num] = 0
									for var i = 0 to (num - 1)
										filename[i] = (char)next_in[0]
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
								if (mask & 4) != 0
									num: uint64 = 0
									for var i = 0 to 5
										num |= (next_in[0] & 0x7f) << (7*i)
										var prev = next_in[0]
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
										if (prev & 0x80) != 0 do break
										if i > 4 or i == 4 and (next_in[0] & 0xf0) != 0x80
											stderr.printf ("Corrupt metadata\n")
											return 1
									var extra_field = new array of char[num + 1]
									extra_field[num] = 0
									for var i = 0 to (num - 1)
										extra_field[i] = (char)next_in[0]
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
								if (mask & 0x40) != 0
									if (((0x34cb00 >> ((next_in[0] ^ ((next_in[0] & 0x7f) >> 4)) & 0xf)) ^ next_in[0]) & 0x80) != 0
										stderr.printf ("Wrong parity\n")
										return 1
									if (mask & 0x47) != 0
										stderr.printf ("Unsupported compression")
										return 1
									offset++
									available_in--
									next_in++
									if available_in == 0
										available_in = fin.read (input_buffer)
										next_in = input_buffer
										if fin.eof () do return 2
										if fin.error () != 0
											stderr.printf ("Failed to read input: %m\n")
											return 1
								if (mask & 0x20) != 0
									for var i = 0 to 1
										offset++
										available_in--
										next_in++
										if available_in == 0
											available_in = fin.read (input_buffer)
											next_in = input_buffer
											if fin.eof () do return 2
											if fin.error () != 0
												stderr.printf ("Failed to read input: %m\n")
												return 1
									stderr.printf ("Unimplemented field")
									return 1
							offset -= cur_offset
							prev_datalen = datalen
							decoder = new Decoder ()
					else if available_in > 6 and Memory.cmp (input_buffer, "BroTL", 5) == 0 and input_buffer[5] == 0
						var userdata_size = input_buffer[6]
						if userdata_size + 7 < available_in
							available_in -= userdata_size + 7
							next_in = input_buffer + userdata_size + 7
						else if userdata_size + 7 == available_in or fin.seek ((long)(userdata_size + 7 - available_in), FileSeek.CUR) == 0
							available_in = fin.read (input_buffer)
							next_in = input_buffer
						else
							if fin.eof () do return 2
							stderr.printf ("Failed to read input: %m\n")
							return 1
					else
						next_in = input_buffer
			when Decoder.Result.NEEDS_MORE_INPUT
				if fin.eof () do return 2
				available_in = fin.read (input_buffer)
				next_in = input_buffer
				if fin.error () != 0
					stderr.printf ("Failed to read input: %m\n")
					return 1
			when Decoder.Result.NEEDS_MORE_OUTPUT
				case check_type
					when 0,1,2 do xxh32state.update (output_buffer, output_buffer.length)
					when 3 do xxh64state.update (output_buffer, output_buffer.length)
					when 4,5,6 do crc32sum = crc32c (crc32sum, output_buffer, output_buffer.length)
					when 7
						if checksum == null
							stderr.printf ("Internal error!\n")
							return 1
						checksum.update (output_buffer, output_buffer.length)
				if fout.write (output_buffer) == 0 do break_loop = true
				else
					available_out = output_buffer.length
					next_out = output_buffer
		if break_loop do break
		var available_in_prev = available_in
		var available_out_prev = available_out
		result = decoder.decompressStream (ref available_in, ref next_in, ref available_out, ref next_out, null)
		datalen += available_out_prev - available_out
		offset += available_in_prev - available_in
		if result == Decoder.Result.ERROR
			stderr.printf ("Corrupt input\n")
			return 1
	if result == Decoder.Result.SUCCESS and next_out != output_buffer
		output: unowned array of uint8 = output_buffer
		output.length -= (int)available_out
		fout.write (output)
	if fout.error () != 0
		stderr.printf ("Failed to write output: %m\n")
		return 1
	return 0

def extern g_lstat (filename: string, out buf: Posix.Stat): int
def extern crc32c (crc: uint32, buf: void*, len: size_t): uint32

fin: FileStream
fout: FileStream
output_file: string

def on_interrupt (signum: int)
	fin = null
	fout = null
	if output_file != null do FileUtils.remove (output_file)
	Process.exit (1)

const signature: uint8[] = {'\xce', '\xb2', '\xcf', '\x81'}

def print_usage ()
	stderr.printf ("Usage: brzip [OPTION]... [FILE]...\nCompress or decompress FILEs in the .br format.\n\n")
	stderr.printf ("  -c, --stdout      write on standard output, keep original files unchanged\n")
	stderr.printf ("  -d, --decompress  decompress\n")
	stderr.printf ("  -f, --force       force overwrite of output file\n")
	stderr.printf ("  -h, --help        give this help\n")
	stderr.printf ("  -k, --keep        keep (don't delete) input files\n")
	stderr.printf ("  -0, --fast        compress faster\n")
	stderr.printf (" -11, --best        compress better\n")
	stderr.printf ("\n\nWith no FILE, or when FILE is -, read standard input.\n")

def main (args: array of string): int
	Intl.setlocale ()
	var
		quality = Encoder.DEFAULT_QUALITY
		opts_end = false
		force = false
		decompressing = false
		from_stdin = true
		to_stdout = false
		num = false
		keep = false
		need_help = false
		retval = 0
	if args[0][0].tolower () == 'b' and args[0][1].tolower () == 'r'
		if args[0][2].tolower () == 'c' and args[0][3].tolower () == 'a' and args[0][4].tolower () == 't'
			to_stdout = true
			decompressing = true
		if args[0][2].tolower () == 'u' and args[0][3].tolower () == 'n' and args[0][4].tolower () == 'z' \
						and args[0][5].tolower () == 'i' and args[0][6].tolower () == 'p'
			decompressing = true
	for var i = 1 to (args.length - 1) do if args[i][0] == '-' and not opts_end
		if args[i][1] == '-' do case args[i]
			when "--" do opts_end = true
			when "--best" do quality = Encoder.MAX_QUALITY
			when "--fast" do quality = Encoder.MIN_QUALITY
			when "--force" do force = true
			when "--decompress" do decompressing = true
			when "--stdout", "--to-stdout" do to_stdout = true
			when "--keep" do keep = true
			when "--help" do need_help = true
			default
				stderr.printf ("%s: unrecognized option '%s'\n\n", args[0], args[1])
				need_help = true
				retval = 1
		else do for j in ((string*)args[i]+1)->data
			case j
				when '1', '2', '3', '4', '5', '6', '7', '8', '9', '0' do quality = (num ? quality * 10 + j - '0' : j - '0')
				when 'c' do to_stdout = true
				when 'd' do decompressing = true
				when 'f' do force = true
				when 'k' do keep = true
				when 'h' do need_help = true
				default
					stderr.printf ("%s: unrecognized option '%c'\n\n", args[0], j)
					need_help = true
					retval = 1
			case j
				when '1', '2', '3', '4', '5', '6', '7', '8', '9', '0' do num = true
				default do num = false
		num = false
		if need_help
			print_usage ()
			return retval
		if retval == 1 do return 1
	else do from_stdin = false
	quality %= Encoder.MAX_QUALITY - Encoder.MIN_QUALITY + 1
	if from_stdin
		fin = FileStream.fdopen (0, "rb")
		fout = FileStream.fdopen (1, "wb")
		if not decompressing do if fout.write (signature) == 0
			stderr.printf ("Failed to write output: %m\n")
			return 1
		retval = 1
		case decompressing ? decompress (fin, fout) : compress (fin, fout, quality)
			when 0 do retval = 0
			when 2 do stderr.printf ("%s: %s: Unexpected end of input\n", args[0], "(stdin)")
		return retval
	if to_stdout
		keep = true
		fout = FileStream.fdopen (1, "wb")
		if not decompressing do if fout.write (signature) == 0
			stderr.printf ("Failed to write output: %m\n")
			return 1
	else do fout = null
	opts_end = false
	st: Posix.Stat
	Process.signal (ProcessSignal.INT, on_interrupt)
	Process.signal (ProcessSignal.TERM, on_interrupt)
	for var i = 1 to (args.length - 1) do if args[i] == "-"
		fin = FileStream.fdopen (0, "rb")
		fout = FileStream.fdopen (1, "wb")
		if not decompressing do if fout.write (signature) == 0
			stderr.printf ("Failed to write output: %m\n")
			return 1
		var error = decompressing ? decompress (fin, fout) : compress (fin, fout, quality)
		if error != 0 do retval = 1
		case error
			when 2 do stderr.printf ("%s: %s: Unexpected end of input\n", args[0], "(stdin)")
		fin = null
		fout = null
	else if args[i][0] == '-' and not opts_end
		if args[i] == "--" do opts_end = true
	else if decompressing
		if g_lstat (args[i], out st) < 0
			stderr.printf ("%s: %s: %m\n", args[0], args[i])
			retval = 1
			continue
		if not Posix.S_ISREG (st.st_mode)
			stderr.printf ("%s: %s: Not a regular file, skipping\n", args[0], args[i])
			if retval != 1 do retval = 2
			continue
		fin = FileStream.open (args[i], "rb")
		if fin == null
			stderr.printf ("%s: %s: %m\n", args[0], args[i])
			retval = 1
			continue
		var inputnamelen = args[i].length
		if not to_stdout and (args[i][inputnamelen-3] != '.' or args[i][inputnamelen-2] != 'b' or args[i][inputnamelen-1] != 'r')
			stderr.printf ("%s: %s: %s\n", args[0], args[i], "Filename has an unknown suffix, skipping")
			if retval != 1 do retval = 2
			continue
		if not to_stdout
			output_file = args[i].substring (0, args[i].length - 3)
			fout = FileStream.open (output_file, force ? "wb" : "wbx")
			if fout == null
				stderr.printf ("%s: %s: %m\n", args[0], output_file)
				retval = 1
				fin = null
				continue
		var error = decompress (fin, fout)
		if error != 0 do retval = 1
		if not to_stdout
			fin = null
			fout = null
			var times = UTimBuf ()
			times.actime = st.st_atime
			times.modtime = st.st_mtime
			if FileUtils.chmod (output_file, (int)st.st_mode) < 0 or FileUtils.utime (output_file, times) < 0
				stderr.printf ("%s: %s: %m\n", args[0], output_file)
				FileUtils.remove (output_file)
				output_file = null
				retval = 1
				continue
			if error != 0 do FileUtils.remove (output_file)
			output_file = null
		case error
			when 0 do if not keep do FileUtils.remove (args[i])
			when 2 do stderr.printf ("%s: %s: Unexpected end of input\n", args[0], args[i])
	else
		if g_lstat (args[i], out st) < 0
			stderr.printf ("%s: %s: %m\n", args[0], args[i])
			retval = 1
			continue
		if not Posix.S_ISREG (st.st_mode)
			stderr.printf ("%s: %s: Not a regular file, skipping\n", args[0], args[i])
			if retval != 1 do retval = 2
			continue
		fin = FileStream.open (args[i], "rb")
		if fin == null
			stderr.printf ("%s: %s: %m\n", args[0], args[i])
			retval = 1
			continue
		if not to_stdout
			output_file = args[i] + ".br"
			fout = FileStream.open (output_file, force ? "wb" : "wbx")
			if fout == null
				stderr.printf ("%s: %s.br: %m\n", args[0], args[i])
				fin = null
				retval = 1
				continue
			if fout.write (signature) == 0
				stderr.printf ("Failed to write output: %m\n")
				fin = null
				fout = null
				FileUtils.remove (output_file)
				retval = 1
				continue
		var error = compress (fin, fout, quality)
		if error != 0 do retval = 1
		if not to_stdout
			fin = null
			fout = null
			var times = UTimBuf ()
			times.actime = st.st_atime
			times.modtime = st.st_mtime
			if FileUtils.chmod (output_file, (int)st.st_mode) < 0 or FileUtils.utime (output_file, times) < 0
				stderr.printf ("%s: %s: %m\n", args[0], output_file)
				FileUtils.remove (output_file)
				output_file = null
				retval = 1
				continue
			if error != 0 do FileUtils.remove (output_file)
			output_file = null
		case error
			when 0 do if not keep do FileUtils.remove (args[i])
	return retval
