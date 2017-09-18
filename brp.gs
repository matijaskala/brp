/*
 * Brotli packer
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

def compress (fin: FileStream, fout: FileStream, quality: uint32): int
	var
		is_eof = false
		compress_failed = true
		encoder = new Encoder ()
	available_in: size_t = 0
	available_out: size_t = output_buffer.length
	next_in: uint8* = null
	next_out: uint8* = output_buffer
	if encoder != null
		compress_failed = false
		encoder.setParameter (Encoder.Parameter.QUALITY, quality)
		do
			if available_in == 0 and not is_eof
				available_in = fin.read (input_buffer)
				next_in = input_buffer
				if fin.error () != 0
					stderr.printf ("Failed to read input: %m\n")
					return 1
				is_eof = fin.eof ()
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
		while not encoder.isFinished ()
	if compress_failed
		stderr.printf ("Failed to compress data\n")
		return 1
	return 0

def decompress (fin: FileStream, fout: FileStream): int
	var
		result = Decoder.Result.SUCCESS
		decoder = new Decoder ()
		break_loop = false
	if decoder == null
		stderr.printf ("Failed to decompress data\n")
		return 1
	available_in: size_t = 0
	available_out: size_t = output_buffer.length
	next_in: uint8* = null
	next_out: uint8* = output_buffer
	while true
		case result
			when Decoder.Result.SUCCESS
				if fin.eof () do break_loop = true
				else
					available_in = fin.read (input_buffer)
					if fin.eof () and available_in == 0 do break_loop = true
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
				if fout.write (output_buffer) == 0 do break_loop = true
				else
					available_out = output_buffer.length
					next_out = output_buffer
		if break_loop do break
		result = decoder.decompressStream (ref available_in, ref next_in, ref available_out, ref next_out, null)
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

fin: FileStream
fout: FileStream
output_file: string

def on_interrupt (signum: int)
	fin = null
	fout = null
	if output_file != null do FileUtils.remove (output_file)
	Process.exit (1)

const signature: uint8[] = {'B', 'r', 'o', 'T', 'L', 0, 0}

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
		retval = 0
	for var i = 1 to (args.length - 1) do if args[i][0] == '-' and not opts_end
		if args[i][1] == '-' do case args[i]
			when "--" do opts_end = true
			when "--best" do quality = Encoder.MAX_QUALITY
			when "--fast" do quality = Encoder.MIN_QUALITY
			when "--force" do force = true
			when "--decompress" do decompressing = true
			when "--stdout", "--to-stdout" do to_stdout = true
			when "--keep" do keep = true
			default
				stderr.printf ("%s: unrecognized option '%s'\n", args[0], args[1])
				retval = 1
		else do for j in ((string*)args[i]+1)->data
			case j
				when '1', '2', '3', '4', '5', '6', '7', '8', '9', '0' do quality = (num ? quality * 10 + j - '0' : j - '0')
				when 'c' do to_stdout = true
				when 'd' do decompressing = true
				when 'f' do force = true
				when 'k' do keep = true
			case j
				when '1', '2', '3', '4', '5', '6', '7', '8', '9', '0' do num = true
				default do num = false
		num = false
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
	for var i = 1 to (args.length - 1) do if args[i][0] == '-' and not opts_end
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
		if not to_stdout and args[i].substring (-3) != ".br"
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
			output_file = null
		case error
			when 0 do if not keep do FileUtils.remove (args[i])
			when 2 do stderr.printf ("%s: %s: Unexpected end of input\n", args[0], args[i])
		if error != 0 do FileUtils.remove (output_file)
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
			output_file = null
		case error
			when 0 do if not keep do FileUtils.remove (args[i])
		if error != 0 do FileUtils.remove (output_file)
	return retval
