-- Kunai mpv bridge: IPC user-data with the Kunai CLI (persistent session only on Unix).
-- user-data: kunai-skip-to, kunai-skip-auto, kunai-skip-kind, kunai-skip-label, kunai-skip-rev,
--             kunai-skip-prompt-ms (countdown + Bun auto-skip alignment)
-- kunai-request: next | previous | skip | auto-skip | quality | refresh | resume-seek
-- kunai-loading: non-empty → full-window "loading episode" overlay (set by Bun or Lua before stop).
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

local _snake_path = nil
local _snake_visits = nil

local prompt_redraw_timer = nil
local prompt_deadline_wall = nil
local prompt_is_auto = false
local prompt_label = ""
local prompt_total_sec = 3
-- True when segment is still active but the manual-mode chip has faded out.
-- Hover over the chip area re-arms the chip for another 3 s.
local prompt_hover_armed = false
local prompt_hover_check_timer = nil

local function signal(action)
	mp.set_property("user-data/kunai-request", action)
end

mp.observe_property("audio", "number", function(name, value)
	if value then
		mp.set_property("user-data/kunai-track-changed", "audio:" .. value)
	end
end)

mp.observe_property("sub", "number", function(name, value)
	if value then
		mp.set_property("user-data/kunai-track-changed", "sub:" .. value)
	end
end)

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
local loading_anim_timer = nil
local loading_started_wall = nil

local function stop_loading_animation()
	if loading_anim_timer ~= nil then
		loading_anim_timer:kill()
		loading_anim_timer = nil
	end
	loading_started_wall = nil
end

local function loading_hint_for_time(elapsed)
	local hints = {
		"Contacting stream providers and validating playback links.",
		"Playback begins automatically once the stream is ready.",
		"High-quality streams take a moment to initialize.",
	}
	local idx = math.floor((elapsed or 0) / 2.3) % #hints
	return hints[idx + 1]
end

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
		stop_loading_animation()
		return
	end

	if not loading_started_wall then
		loading_started_wall = mp.get_time()
	end

	local dim = mp.get_property_native("osd-dimensions", {})
	local w = dim.w or 1280
	local h = dim.h or 720
	local cx = math.floor(w / 2)
	local cy = math.floor(h / 2)
	local elapsed = math.max(0, mp.get_time() - loading_started_wall)

	-- Strip the "Kunai · " routing prefix so the main text is the actual title/action.
	local display = kunai_loading_text
	do
		local prefix = "kunai \xc2\xb7 "
		if display:lower():sub(1, #prefix) == prefix then
			display = kunai_loading_text:sub(#prefix + 1)
		end
		-- Remove trailing ellipsis (… or ...) and whitespace.
		display = display:gsub("\xe2\x80\xa6$", ""):gsub("%.%.%.$", ""):match("^%s*(.-)%s*$") or display
	end

	local main_fs = clamp(math.floor(h * 0.052), 30, 54)
	local sub_fs = clamp(math.floor(h * 0.022), 13, 20)
	local brand_fs = clamp(math.floor(h * 0.014), 9, 12)

	-- Cycling hint appears only after 3 s to avoid noise on fast loads.
	local hint_line = elapsed >= 3.0 and esc_ass(loading_hint_for_time(elapsed)) or ""

	local main_y = math.floor(cy - h * 0.02)
	local hint_y = math.floor(cy + h * 0.09)
	local brand_y = h - clamp(math.floor(h * 0.055), 30, 52)

	loading_overlay.res_x = w
	loading_overlay.res_y = h

	local parts = {}

	-- 5×5 snake dot-matrix loader (mirrors DotmSquare2 React component).
	if not _snake_path then
		_snake_path = {}
		_snake_visits = {}
		for i = 1, 25 do _snake_visits[i] = {} end
		local function sp(r, c)
			local idx = r * 5 + c + 1
			table.insert(_snake_path, idx)
			table.insert(_snake_visits[idx], #_snake_path - 1) -- 0-based step
		end
		for r = 4, 0, -1 do sp(r, 0) end
		sp(0, 1); sp(0, 2)
		for r = 1, 4 do sp(r, 2) end
		sp(4, 1)
		for r = 3, 0, -1 do sp(r, 1) end
		sp(0, 2); sp(0, 3)
		for r = 1, 4 do sp(r, 3) end
		sp(4, 2)
		for r = 3, 0, -1 do sp(r, 2) end
		sp(0, 3); sp(0, 4)
		for r = 1, 4 do sp(r, 4) end
	end

	local snake_tail = {1.0, 0.82, 0.68, 0.54, 0.42, 0.31, 0.22, 0.14}
	local snake_base = 0.08
	local route_len = #_snake_path
	local head = math.floor(elapsed * (route_len / 1.5)) % route_len

	local dot_r = clamp(math.floor(h * 0.008), 4, 8)
	local dot_spacing = dot_r * 3 + 2
	local grid_cx = cx
	local grid_cy = math.floor(cy - h * 0.11)

	local k_bez = math.floor(dot_r * 0.5523 + 0.5)
	local circle_path = string.format(
		"m %d %d b %d %d %d %d %d %d b %d %d %d %d %d %d b %d %d %d %d %d %d b %d %d %d %d %d %d",
		-dot_r, 0,
		-dot_r, -k_bez, -k_bez, -dot_r, 0, -dot_r,
		k_bez, -dot_r, dot_r, -k_bez, dot_r, 0,
		dot_r, k_bez, k_bez, dot_r, 0, dot_r,
		-k_bez, dot_r, -dot_r, k_bez, -dot_r, 0
	)

	for row = 0, 4 do
		for col = 0, 4 do
			local index = row * 5 + col + 1
			local visits = _snake_visits[index]
			local opacity = snake_base
			for _, step in ipairs(visits) do
				local dist = (head - step + route_len) % route_len
				if dist < #snake_tail then
					local t = snake_tail[dist + 1]
					if t > opacity then opacity = t end
				end
			end

			local alpha_byte = clamp(math.floor((1 - opacity) * 255), 0, 255)
			local alpha_str = string.format("%02X", alpha_byte)

			local dot_x = grid_cx + (col - 2) * dot_spacing
			local dot_y = grid_cy + (row - 2) * dot_spacing

			table.insert(parts, string.format(
				"{\\an5\\pos(%d,%d)\\bord0\\shad0\\blur0\\1c&HFFFFFF&\\1a&H%s&\\p1}%s{\\p0}",
				dot_x, dot_y, alpha_str, circle_path
			))
		end
	end

	-- Main label: stripped loading text (media title, episode, action).
	table.insert(parts, string.format(
		"{\\an5\\bord3\\blur2\\shadow1\\shadowcolor&H55000000&\\fnSans\\b1\\fs%d\\pos(%d,%d)\\c&HFFFFFF&}%s",
		main_fs, cx, main_y, esc_ass(display)
	))

	if hint_line ~= "" then
		table.insert(parts, string.format(
			"{\\an5\\bord0\\blur1\\fnSans\\fs%d\\pos(%d,%d)\\c&HC8C8C8&\\alpha&HA8&}%s",
			sub_fs, cx, hint_y, hint_line
		))
	end

	-- Subtle brand watermark anchored near the bottom edge.
	table.insert(parts, string.format(
		"{\\an5\\bord0\\blur2\\fnSans\\fs%d\\pos(%d,%d)\\c&HFFFFFF&\\alpha&HC8&}K U N A I",
		brand_fs, cx, brand_y
	))

	loading_overlay.data = table.concat(parts, "\n")
	loading_overlay:update()
end

local function ensure_loading_animation()
	if kunai_loading_text == "" then
		stop_loading_animation()
		return
	end
	if loading_anim_timer ~= nil then
		return
	end
	loading_anim_timer = mp.add_periodic_timer(0.08, function()
		if kunai_loading_text == "" then
			stop_loading_animation()
			return
		end
		draw_kunai_loading_overlay()
	end)
end

mp.observe_property("user-data/kunai-loading", "native", function(_, val)
	sync_kunai_loading_text(val)
	draw_kunai_loading_overlay()
	ensure_loading_animation()
end)

mp.observe_property("osd-dimensions", "native", function()
	if kunai_loading_text ~= "" then
		draw_kunai_loading_overlay()
	end
end)

pcall(function()
	sync_kunai_loading_text(mp.get_property_native("user-data/kunai-loading"))
	draw_kunai_loading_overlay()
	ensure_loading_animation()
end)

-- Seed the loading overlay immediately at launch so the window never shows
-- as a raw black frame. Bun clears kunai-loading once file-loaded fires.
-- Only activates when nothing else has already set the loading text.
pcall(function()
	if kunai_loading_text == "" then
		local mt = mp.get_property("media-title", "")
		if mt == "" or mt == "-" then
			mt = "Connecting to stream"
		end
		mp.set_property("user-data/kunai-loading", "Kunai \xc2\xb7 " .. mt)
	end
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
	local margin = clamp(math.floor(w * 0.035), 28, 72)
	local top = clamp(math.floor(h * 0.055), 28, 58)
	local x = w - margin
	local y = top
	local fs = clamp(math.floor(h * 0.026), 18, 30)
	local sub_fs = clamp(math.floor(h * 0.018), 12, 17)

	local label = mp.get_property("user-data/kunai-resume-label", "")
	if label == "" then
		label = format_hms(at_sec)
	end
	local title = mp.get_property("user-data/kunai-resume-title", "Kunai")

	local line1 = esc_ass(title)
	local line2 = esc_ass("Resume at " .. label .. "  ·  or start from the beginning")
	local line3 = esc_ass("[Ctrl+R] resume   [O] start over")

	local ass_nl = "\\N"
	resume_overlay.res_x = w
	resume_overlay.res_y = h
	resume_overlay.data = string.format(
		"{\\an9\\bord3\\blur2\\fnSans\\b1\\fs%d\\pos(%d,%d)\\c&HF0F0F0&}%s",
		fs,
		x,
		y,
		line1
	)
		.. ass_nl
		.. string.format(
			"{\\an9\\alpha&HC0&\\fs%d\\pos(%d,%d)\\c&HDDDDDD&}%s",
			sub_fs,
			x,
			y + math.floor(fs * 1.25),
			line2
		)
		.. ass_nl
		.. string.format(
			"{\\an9\\alpha&HB0&\\fs%d\\pos(%d,%d)\\c&HBBBBBB&}%s",
			sub_fs,
			x,
			y + math.floor(fs * 2.2),
			line3
		)
	resume_overlay:update()
end

local function commit_resume_choice(which)
	hide_resume_prompt()
	mp.set_property("user-data/kunai-resume-choice", which)
end

local function show_resume_prompt(at_sec)
	-- Dismiss the loading overlay so it doesn't overlap the resume prompt.
	if kunai_loading_text ~= "" then
		kunai_loading_text = ""
		loading_overlay.data = ""
		loading_overlay:remove()
		stop_loading_animation()
	end
	hide_resume_prompt()
	draw_resume_prompt(at_sec)
	clear_resume_prompt_bindings()
	mp.add_forced_key_binding("Ctrl+r", "kunai-resume-r", function()
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
		commit_resume_choice("start")
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

local function rounded_rect_path(w, h, r)
	w = math.max(0, math.floor(w))
	h = math.max(0, math.floor(h))
	r = clamp(math.floor(r), 0, math.floor(math.min(w, h) * 0.5))
	if w <= 0 or h <= 0 then
		return ""
	end
	if r <= 0 then
		return string.format("m 0 0 l %d 0 l %d %d l 0 %d l 0 0", w, w, h, h)
	end

	local c = math.floor(r * 0.55228475 + 0.5)
	return string.format(
		"m %d %d l %d %d b %d %d %d %d %d %d l %d %d b %d %d %d %d %d %d l %d %d b %d %d %d %d %d %d l %d %d b %d %d %d %d %d %d",
		r,
		0,
		w - r,
		0,
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
		0,
		h - r + c,
		0,
		h - r,
		0,
		r,
		0,
		r - c,
		r - c,
		0,
		r,
		0
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
	if prompt_hover_check_timer ~= nil then
		prompt_hover_check_timer:kill()
		prompt_hover_check_timer = nil
	end
	prompt_hover_armed = false
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

local draw_prompt_frame
local on_skip_click

local function arm_prompt_hover_check()
	if prompt_hover_check_timer ~= nil then
		return
	end

	prompt_hover_armed = true
	prompt_hover_check_timer = mp.add_periodic_timer(0.1, function()
		local skip_to = mp.get_property_number("user-data/kunai-skip-to", -1)
		if skip_to <= 0 then
			if prompt_hover_check_timer ~= nil then
				prompt_hover_check_timer:kill()
				prompt_hover_check_timer = nil
			end
			prompt_hover_armed = false
			return
		end

		if not prompt_hover_armed or not chip_hovered() then
			return
		end

		prompt_hover_armed = false
		if prompt_hover_check_timer ~= nil then
			prompt_hover_check_timer:kill()
			prompt_hover_check_timer = nil
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
				pcall(function() mp.remove_key_binding("kunai-skip-click") end)
				overlay.data = ""
				overlay:remove()
				prompt_deadline_wall = nil
				arm_prompt_hover_check()
			end
		end)
		mp.add_forced_key_binding("MBTN_LEFT", "kunai-skip-click", on_skip_click, { complex = true })
	end)
end

function draw_prompt_frame()
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
	local radius = clamp(math.floor(chip_h * 0.19), 14, 24)

	local icon_box = clamp(math.floor(chip_h * 0.48), 38, 54)
	local icon_size = clamp(math.floor(chip_h * 0.27), 22, 32)

	local title_fs = clamp(math.floor(chip_h * 0.32), 25, 39)
	local sub_fs = clamp(math.floor(chip_h * 0.17), 13, 20)

	local bar_h = clamp(math.floor(chip_h * 0.10), 6, 10)
	local bar_w = chip_w - (pad * 2)
	local fill_w = math.max(0, math.floor(bar_w * p))

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

	local bg_path = rounded_rect_path(chip_w, chip_h, radius)
	local icon_bg_path = rounded_rect_path(icon_box, icon_box, math.floor(icon_box * 0.5))
	local bar_bg_path = rounded_rect_path(bar_w, bar_h, math.floor(bar_h * 0.5))
	local bar_fill_path = fill_w > 0 and rounded_rect_path(fill_w, bar_h, math.min(math.floor(bar_h * 0.5), math.floor(fill_w * 0.5))) or ""
	local icon_path = skip_icon_path(icon_size)

	local bg_alpha = hovered and "04" or "18"
	local border_alpha = hovered and "32" or "78"
	local fill_alpha = hovered and "00" or (prompt_is_auto and "08" or "18")
	local fill_color = prompt_is_auto and "H86F7A9&" or "H59D7FF&"

	local title_color = hovered and "HFFFFFF&" or "HF4F4F4&"
	local sub_color = hovered and "HE8E8E8&" or "HCFCFCF&"

	local icon_bg_x = x0 + pad
	local icon_bg_y = y0 + math.floor((chip_h - icon_box) * 0.42)
	local icon_x = icon_bg_x + math.floor((icon_box - icon_size) * 0.56)
	local icon_y = icon_bg_y + math.floor((icon_box - icon_size) * 0.5)

	local text_x = icon_bg_x + icon_box + math.floor(chip_h * 0.17)
	local title_y = y0 + math.floor(chip_h * 0.18)
	local sub_y = y0 + math.floor(chip_h * 0.55)
	local bar_y = y0 + chip_h - pad - bar_h

	local ass = table.concat({
		-- Big soft shadow.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\blur4\\1c&H000000&\\1a&H70&\\p1}%s{\\p0}",
			x0 + 4,
			y0 + 5,
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

		-- Icon well gives the asymmetrical skip glyph a stable visual anchor.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\1c&HFFFFFF&\\1a&HDC&\\p1}%s{\\p0}",
			icon_bg_x,
			icon_bg_y,
			icon_bg_path
		),

		-- Progress track.
		string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\1c&H555555&\\1a&H38&\\p1}%s{\\p0}",
			x0 + pad,
			bar_y,
			bar_bg_path
		),

		fill_w > 0 and string.format(
			"{\\an7\\pos(%d,%d)\\bord0\\shad0\\1c&%s\\1a&H%s&\\p1}%s{\\p0}",
			x0 + pad,
			bar_y,
			fill_color,
			fill_alpha,
			bar_fill_path
		) or "",

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

function on_skip_click(e)
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
			prompt_deadline_wall = nil

			if prompt_is_auto then
				signal("auto-skip")
			else
				-- Netflix behaviour: chip faded; keep a cheap hover poll so it
				-- reappears from the hidden state while the skip zone is still active.
				arm_prompt_hover_check()
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
	mp.osd_message("Kunai · Select quality in the terminal", 2.5)
	signal("quality")
end

local function do_refresh()
	mp.set_property("user-data/kunai-loading", "Kunai · Refreshing stream (same episode)…")
	sync_kunai_loading_text(mp.get_property_native("user-data/kunai-loading"))
	draw_kunai_loading_overlay()
	signal("refresh")
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

-- Same episode: re-resolve the stream URL (cache bust) and resume from the saved position.
mp.add_key_binding("ctrl+r", "kunai-refresh", do_refresh, { repeatable = false })

-- Seek to the last saved history position for the current episode without re-resolving.
local function do_resume_seek()
	signal("resume-seek")
end
mp.add_key_binding("Alt+r", "kunai-resume-seek", do_resume_seek, { repeatable = false })
