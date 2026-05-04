-- Kunai mpv bridge: IPC user-data with the Kunai CLI (persistent session only on Unix).
-- user-data: kunai-skip-to, kunai-skip-auto, kunai-skip-kind, kunai-skip-label, kunai-skip-rev,
--             kunai-skip-prompt-ms (countdown + Bun auto-skip alignment)
-- kunai-request: next | previous | skip | auto-skip | quality
-- kunai-loading: non-empty → full-window “loading episode” overlay (set by Bun or Lua before stop).
-- kunai-resume-at: seconds > 0 → resume vs start-over prompt (kunai-resume-choice: resume|start).
--
-- Script-opts id `kunai-bridge`: margin_bottom, margin_right, chip_width, chip_height, prompt_seconds (Lua-only fallback if prompt-ms unset)

local o = {
	margin_bottom = "118",
	margin_right = "44",
	chip_width = "280",
	chip_height = "58",
	prompt_seconds = "3",
}

do
	local ok, mod = pcall(require, "mp.options")
	if ok and mod and mod.read_options then
		mod.read_options(o, "kunai-bridge")
	end
end

local overlay = mp.create_osd_overlay("ass-events")
overlay.z = 1600

local prompt_redraw_timer = nil
local prompt_deadline_wall = nil
local prompt_is_auto = false
local prompt_label = ""
local prompt_total_sec = 3

local function signal(action)
	mp.set_property("user-data/kunai-request", action)
end

local function clamp(v, lo, hi)
	if v < lo then
		return lo
	end
	if v > hi then
		return hi
	end
	return v
end

local function esc_ass(s)
	s = tostring(s or "")
	s = s:gsub("\\", "\\\\")
	s = s:gsub("{", "\\{")
	s = s:gsub("}", "\\}")
	return s
end

-- Full-window loading pane between episodes (survives stop → idle → loadfile gaps).
local loading_overlay = mp.create_osd_overlay("ass-events")
loading_overlay.z = 1700

local kunai_loading_text = ""

local function sync_kunai_loading_text(raw)
	if type(raw) == "string" then
		kunai_loading_text = raw
	elseif raw ~= nil and raw ~= false then
		kunai_loading_text = tostring(raw)
	else
		kunai_loading_text = ""
	end
end

local function draw_kunai_loading_overlay()
	if kunai_loading_text == "" then
		loading_overlay.data = ""
		loading_overlay:remove()
		return
	end

	local dim = mp.get_property_native("osd-dimensions", {})
	local w = dim.w or 1280
	local h = dim.h or 720
	local fs = clamp(math.floor(h * 0.046), 26, 48)
	local cx = math.floor(w / 2)
	local cy = math.floor(h / 2)

	local line = esc_ass(kunai_loading_text)
	local hint_fs = clamp(math.floor(h * 0.022), 12, 20)
	local hint_line = esc_ass("Resolving stream — playback will start automatically.")

	loading_overlay.res_x = w
	loading_overlay.res_y = h
	local ass_nl = "\\N"
	loading_overlay.data = string.format(
		"{\\an5\\bord5\\blur4\\shadow1\\shadowcolor&H40000000&\\fnSans\\fs%d\\pos(%d,%d)\\c&HF8F8F8&}%s"
			.. ass_nl
			.. "{\\alpha&HB0&\\fs%d}%s",
		fs,
		cx,
		cy - math.floor(fs * 0.15),
		line,
		hint_fs,
		hint_line
	)
	loading_overlay:update()
end

mp.observe_property("user-data/kunai-loading", "native", function(_, val)
	sync_kunai_loading_text(val)
	draw_kunai_loading_overlay()
end)

mp.observe_property("osd-dimensions", "native", function()
	if kunai_loading_text ~= "" then
		draw_kunai_loading_overlay()
	end
end)

pcall(function()
	sync_kunai_loading_text(mp.get_property_native("user-data/kunai-loading"))
	draw_kunai_loading_overlay()
end)

mp.register_event("file-loaded", function()
	mp.set_property("user-data/kunai-loading", "")
	mp.set_property("user-data/kunai-resume-at", 0)
	mp.set_property("user-data/kunai-resume-choice", "")
end)

-- Resume vs start-over (persistent session; Bun sets kunai-resume-at > 0).
local resume_overlay = mp.create_osd_overlay("ass-events")
resume_overlay.z = 1650

local resume_prompt_timer = nil

local function clear_resume_prompt_bindings()
	pcall(function()
		mp.remove_key_binding("kunai-resume-r")
	end)
	pcall(function()
		mp.remove_key_binding("kunai-resume-o")
	end)
	pcall(function()
		mp.remove_key_binding("kunai-resume-enter")
	end)
end

local function hide_resume_prompt()
	if resume_prompt_timer ~= nil then
		resume_prompt_timer:kill()
		resume_prompt_timer = nil
	end
	clear_resume_prompt_bindings()
	resume_overlay.data = ""
	resume_overlay:remove()
end

local function format_hms(total_sec)
	local s = math.max(0, math.floor(total_sec or 0))
	local h = math.floor(s / 3600)
	local m = math.floor((s % 3600) / 60)
	local r = s % 60
	if h > 0 then
		return string.format("%d:%02d:%02d", h, m, r)
	end
	return string.format("%d:%02d", m, r)
end

local function draw_resume_prompt(at_sec)
	local dim = mp.get_property_native("osd-dimensions", {})
	local w = dim.w or 1280
	local h = dim.h or 720
	local cx = math.floor(w / 2)
	local cy = math.floor(h / 2)
	local fs = clamp(math.floor(h * 0.042), 24, 42)
	local sub_fs = clamp(math.floor(h * 0.022), 13, 20)

	local label = mp.get_property("user-data/kunai-resume-label", "")
	if label == "" then
		label = format_hms(at_sec)
	end
	local title = mp.get_property("user-data/kunai-resume-title", "Kunai")

	local line1 = esc_ass(title)
	local line2 = esc_ass("Resume at " .. label .. "  ·  or start from the beginning")
	local line3 = esc_ass("[R] resume   [O] start over   (auto-resume in 8s)")

	local ass_nl = "\\N"
	resume_overlay.res_x = w
	resume_overlay.res_y = h
	resume_overlay.data = string.format(
		"{\\an5\\bord4\\blur3\\fnSans\\fs%d\\pos(%d,%d)\\c&HF0F0F0&}%s",
		fs,
		cx,
		cy - math.floor(fs * 0.9),
		line1
	)
		.. ass_nl
		.. string.format(
			"{\\an5\\alpha&HC0&\\fs%d\\pos(%d,%d)\\c&HDDDDDD&}%s",
			sub_fs,
			cx,
			cy + math.floor(fs * 0.15),
			line2
		)
		.. ass_nl
		.. string.format(
			"{\\an5\\alpha&HB0&\\fs%d\\pos(%d,%d)\\c&HBBBBBB&}%s",
			sub_fs,
			cx,
			cy + math.floor(fs * 0.55),
			line3
		)
	resume_overlay:update()
end

local function commit_resume_choice(which)
	hide_resume_prompt()
	mp.set_property("user-data/kunai-resume-choice", which)
end

local function show_resume_prompt(at_sec)
	hide_resume_prompt()
	draw_resume_prompt(at_sec)
	clear_resume_prompt_bindings()
	mp.add_forced_key_binding("r", "kunai-resume-r", function()
		commit_resume_choice("resume")
	end)
	mp.add_forced_key_binding("o", "kunai-resume-o", function()
		commit_resume_choice("start")
	end)
	mp.add_forced_key_binding("ENTER", "kunai-resume-enter", function()
		commit_resume_choice("resume")
	end)

	resume_prompt_timer = mp.add_timeout(8, function()
		resume_prompt_timer = nil
		commit_resume_choice("resume")
	end)
end

mp.observe_property("user-data/kunai-resume-at", "native", function(_, val)
	local n = 0
	if type(val) == "number" then
		n = val
	elseif type(val) == "string" and val ~= "" then
		n = tonumber(val) or 0
	end
	if n > 0 then
		show_resume_prompt(n)
	else
		hide_resume_prompt()
	end
end)

local function round_rect_path(w, h, r)
	r = math.floor(clamp(r, 1, math.min(w, h) / 2))
	local c = math.floor(r * 0.55228475 + 0.5)

	return string.format(
		"m %d 0 "
			.. "l %d 0 "
			.. "b %d 0 %d %d %d %d "
			.. "l %d %d "
			.. "b %d %d %d %d %d %d "
			.. "l %d %d "
			.. "b %d %d 0 %d 0 %d "
			.. "l 0 %d "
			.. "b 0 %d %d 0 %d 0",
		r,
		w - r,
		w - r + c,
		0,
		w,
		r - c,
		w,
		r,
		w,
		h - r,
		w,
		h - r + c,
		w - r + c,
		h,
		w - r,
		h,
		r,
		h,
		r - c,
		h,
		h - r + c,
		h - r,
		r,
		r - c,
		r - c,
		r
	)
end

local function skip_icon_path(size)
	local s = math.floor(size)
	local gap = math.floor(s * 0.08)

	local t1_w = math.floor(s * 0.34)
	local t2_x = t1_w + gap
	local t2_w = math.floor(s * 0.34)
	local bar_x = t2_x + t2_w + gap
	local bar_w = math.max(3, math.floor(s * 0.10))

	local mid = math.floor(s * 0.5)

	return string.format(
		"m 0 0 l %d %d l 0 %d " .. "m %d 0 l %d %d l %d %d " .. "m %d 0 l %d 0 l %d %d l %d %d",
		t1_w,
		mid,
		s,
		t2_x,
		t2_x + t2_w,
		mid,
		t2_x,
		s,
		bar_x,
		bar_x + bar_w,
		bar_x + bar_w,
		s,
		bar_x,
		s
	)
end

local function clear_prompt_timers()
	if prompt_redraw_timer ~= nil then
		prompt_redraw_timer:kill()
		prompt_redraw_timer = nil
	end

	prompt_deadline_wall = nil

	pcall(function()
		mp.remove_key_binding("kunai-skip-click")
	end)
end

local function hide_prompt_visual()
	clear_prompt_timers()
	overlay.data = ""
	overlay:remove()
end

local function layout_chip()
	local dim = mp.get_property_native("osd-dimensions", {})
	local w = dim.w or 1280
	local h = dim.h or 720

	-- Netflix-like responsive pill sizing.
	local chip_w = clamp(math.floor(w * 0.24), 330, 570)
	local chip_h = clamp(math.floor(h * 0.095), 76, 112)

	local mr = clamp(math.floor(w * 0.035), 28, 76)
	local mb = clamp(math.floor(h * 0.13), 84, 174)

	local x1 = w - mr
	local y1 = h - mb
	local x0 = x1 - chip_w
	local y0 = y1 - chip_h

	return w, h, chip_w, chip_h, x0, y0, x1, y1
end

local function hit_skip_chip(mx, my)
	local _, _, chip_w, chip_h, x0, y0 = layout_chip()
	return mx >= x0 and mx <= x0 + chip_w and my >= y0 and my <= y0 + chip_h
end

local function chip_hovered()
	local pos = mp.get_property_native("mouse-pos", {})
	if not pos or pos.x == nil or pos.y == nil then
		return false
	end

	return hit_skip_chip(pos.x, pos.y)
end

local function draw_prompt_frame()
	if not prompt_deadline_wall then
		return
	end

	local skip_to = mp.get_property_number("user-data/kunai-skip-to", -1)
	if skip_to <= 0 then
		hide_prompt_visual()
		return
	end

	local w, h, chip_w, chip_h, x0, y0 = layout_chip()

	local remaining = prompt_deadline_wall - mp.get_time()
	if remaining < 0 then
		remaining = 0
	end

	local sec = math.max(0, math.ceil(remaining))
	local p = 1 - (remaining / prompt_total_sec)
	p = clamp(p, 0, 1)

	local hovered = chip_hovered()

	local pad = math.floor(chip_h * 0.16)
	local radius = math.floor(chip_h * 0.36)

	local icon_size = clamp(math.floor(chip_h * 0.30), 22, 34)

	local title_fs = clamp(math.floor(chip_h * 0.32), 25, 39)
	local sub_fs = clamp(math.floor(chip_h * 0.17), 13, 20)

	local bar_h = clamp(math.floor(chip_h * 0.10), 6, 10)
	local bar_w = chip_w - (pad * 2)
	local fill_w = math.max(1, math.floor(bar_w * p))

	local label = prompt_label
	if label == "" or label == "SKIP" then
		label = "Skip Intro"
	end
	label = esc_ass(label)

	local subline
	if prompt_is_auto then
		subline = "Auto-skip in " .. tostring(sec) .. "s"
	else
		subline = sec > 0 and ("Click or press B  ·  " .. tostring(sec) .. "s") or "Click or press B"
	end
	subline = esc_ass(subline)

	local bg_path = round_rect_path(chip_w, chip_h, radius)
	local bar_bg_path = round_rect_path(bar_w, bar_h, math.floor(bar_h / 2))
	local bar_fill_path = round_rect_path(fill_w, bar_h, math.floor(bar_h / 2))
	local icon_path = skip_icon_path(icon_size)

	local bg_alpha = hovered and "06" or "18"
	local border_alpha = hovered and "38" or "78"
	local fill_alpha = hovered and "00" or "10"

	local title_color = hovered and "HFFFFFF&" or "HF4F4F4&"
	local sub_color = hovered and "HE8E8E8&" or "HCFCFCF&"

	local icon_x = x0 + pad
	local icon_y = y0 + math.floor((chip_h - icon_size) * 0.42)

	local text_x = icon_x + icon_size + math.floor(chip_h * 0.18)
	local title_y = y0 + math.floor(chip_h * 0.18)
	local sub_y = y0 + math.floor(chip_h * 0.55)
	local bar_y = y0 + chip_h - pad - bar_h

	local ass = table.concat({
		-- Big soft shadow.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\blur4\\1c&H000000&\\1a&H70&\\p1}%s{\\p0}",
			x0 + 5,
			y0 + 6,
			bg_path
		),

		-- Main translucent dark pill.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\blur0\\1c&H101010&\\1a&H%s&\\p1}%s{\\p0}",
			x0,
			y0,
			bg_alpha,
			bg_path
		),

		-- White border.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord2\\3c&HFFFFFF&\\3a&H%s&\\1c&H101010&\\1a&HFF&\\p1}%s{\\p0}",
			x0,
			y0,
			border_alpha,
			bg_path
		),

		-- Progress track.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\1c&H555555&\\1a&H38&\\p1}%s{\\p0}",
			x0 + pad,
			bar_y,
			bar_bg_path
		),

		-- Progress fill.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\1c&HFFFFFF&\\1a&H%s&\\p1}%s{\\p0}",
			x0 + pad,
			bar_y,
			fill_alpha,
			bar_fill_path
		),

		-- Vector skip icon.
		string.format("{\\an7\\pos(%d,%d)\\bord0\\shad0\\1c&HFFFFFF&\\1a&H08&\\p1}%s{\\p0}", icon_x, icon_y, icon_path),

		-- Main label.
		string.format(
			"{\\an7\\pos(%d,%d)\\fs%d\\b1\\bord0\\shad0\\1c&%s}%s",
			text_x,
			title_y,
			title_fs,
			title_color,
			label
		),

		-- Helper text.
		string.format(
			"{\\an7\\pos(%d,%d)\\fs%d\\b0\\bord0\\shad0\\1c&%s}%s",
			text_x,
			sub_y,
			sub_fs,
			sub_color,
			subline
		),
	}, "\n")

	overlay.res_x = w
	overlay.res_y = h
	overlay.data = ass
	overlay:update()
end

local function on_skip_click(e)
	if e and e.event ~= "up" then
		return
	end

	local pos = mp.get_property_native("mouse-pos", {})
	if not pos or not pos.x then
		return
	end

	if hit_skip_chip(pos.x, pos.y) and mp.get_property_number("user-data/kunai-skip-to", -1) > 0 then
		signal("skip")
	end
end

local function restart_skip_prompt()
	hide_prompt_visual()

	local skip_to = mp.get_property_number("user-data/kunai-skip-to", -1)
	if skip_to <= 0 then
		return
	end

	prompt_is_auto = mp.get_property("user-data/kunai-skip-auto") == "1"

	prompt_label = mp.get_property("user-data/kunai-skip-label", "Skip Intro")
	if prompt_label == "" then
		prompt_label = "Skip Intro"
	end

	local ms = mp.get_property_number("user-data/kunai-skip-prompt-ms", 0)
	if ms >= 1000 then
		prompt_total_sec = ms / 1000
	else
		prompt_total_sec = tonumber(o.prompt_seconds) or 3
	end

	if prompt_total_sec < 0.5 then
		prompt_total_sec = 3
	end

	prompt_deadline_wall = mp.get_time() + prompt_total_sec
	overlay.hidden = false

	draw_prompt_frame()

	prompt_redraw_timer = mp.add_periodic_timer(0.05, function()
		local st = mp.get_property_number("user-data/kunai-skip-to", -1)
		if st <= 0 then
			hide_prompt_visual()
			return
		end

		local rem = prompt_deadline_wall - mp.get_time()
		draw_prompt_frame()

		if rem <= 0 then
			if prompt_redraw_timer ~= nil then
				prompt_redraw_timer:kill()
				prompt_redraw_timer = nil
			end

			pcall(function()
				mp.remove_key_binding("kunai-skip-click")
			end)

			overlay.data = ""
			overlay:remove()

			if prompt_is_auto then
				signal("auto-skip")
			end
		end
	end)

	mp.add_forced_key_binding("MBTN_LEFT", "kunai-skip-click", on_skip_click, { complex = true })
end

mp.observe_property("user-data/kunai-skip-rev", "native", function()
	restart_skip_prompt()
end)

local function do_next()
	mp.set_property("user-data/kunai-loading", "Kunai · Loading next episode…")
	sync_kunai_loading_text(mp.get_property_native("user-data/kunai-loading"))
	draw_kunai_loading_overlay()
	signal("next")
	mp.commandv("stop")
end

local function do_previous()
	mp.set_property("user-data/kunai-loading", "Kunai · Loading previous episode…")
	sync_kunai_loading_text(mp.get_property_native("user-data/kunai-loading"))
	draw_kunai_loading_overlay()
	signal("previous")
	mp.commandv("stop")
end

local function do_skip()
	if mp.get_property_number("user-data/kunai-skip-to", -1) > 0 then
		signal("skip")
	end
end

local function do_quality()
	mp.set_property("user-data/kunai-loading", "Kunai · Opening quality picker…")
	sync_kunai_loading_text(mp.get_property_native("user-data/kunai-loading"))
	draw_kunai_loading_overlay()
	signal("quality")
	mp.commandv("stop")
end

mp.add_key_binding("n", "kunai-next", do_next, { repeatable = false })
mp.add_key_binding("N", "kunai-next-shift", do_next, { repeatable = false })

mp.add_key_binding("p", "kunai-prev", do_previous, { repeatable = false })
mp.add_key_binding("P", "kunai-prev-shift", do_previous, { repeatable = false })

-- Skip intro / recap / credits.
-- Safe: does nothing unless user-data/kunai-skip-to is active.
mp.add_key_binding("b", "kunai-skip", do_skip, { repeatable = false })
mp.add_key_binding("k", "kunai-quality", do_quality, { repeatable = false })
mp.add_key_binding("K", "kunai-quality-shift", do_quality, { repeatable = false })
