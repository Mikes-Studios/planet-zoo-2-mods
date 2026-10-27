-----------------------------------------------------------------------
--  PZ2QoL.Handover
--
--  What a Lua feature shares with the mod's pages:
--    Listen                 its event listeners on a view, each call in
--                           pcall (a failure goes to the trace, named by
--                           its event);
--    Put / Pending / Ack    one request kept for a page until the page
--                           confirms it: numbered, handed over on every
--                           hello, dropped on its ack or once older than
--                           the owner's nPendingSeconds.
--  The owner keeps the request in its own fields: nSeq, tPending.
-----------------------------------------------------------------------
local global   = _G
local pcall    = global.pcall
local tostring = global.tostring
local tonumber = global.tonumber
local ipairs   = global.ipairs

local Handover = module(...)

-- tListeners: { { sEvent, nArgs, fn(...) }, ... } -> true, or false + why
Handover.Listen = function(oUI, oOwner, fnTrace, tListeners)
	return pcall(function()
		for _, tListener in ipairs(tListeners) do
			local sEvent, fn = tListener[1], tListener[3]
			oUI:AddEventListener(sEvent, tListener[2], function(_, ...)
				local bOk, sErr = pcall(fn, ...)
				if not bOk then
					fnTrace(sEvent .. " failed: " .. tostring(sErr))
				end
			end, oOwner)
		end
	end)
end

-- The owner's new request, replacing any other (tItem gets nSeq, nTime).
Handover.Put = function(oOwner, tItem, nNow)
	oOwner.nSeq = oOwner.nSeq + 1
	tItem.nSeq = oOwner.nSeq
	tItem.nTime = nNow
	oOwner.tPending = tItem
	return tItem
end

-- The request to hand over, or nil: none, or too old (dropped; true second).
Handover.Pending = function(oOwner, nNow)
	local tItem = oOwner.tPending
	if tItem == nil then
		return nil, false
	end
	if nNow - tItem.nTime > oOwner.nPendingSeconds then
		oOwner.tPending = nil
		return nil, true
	end
	return tItem, false
end

-- true when nSeq is the request in hand, which is then dropped
Handover.Ack = function(oOwner, nSeq)
	if oOwner.tPending ~= nil and tonumber(nSeq) == oOwner.tPending.nSeq then
		oOwner.tPending = nil
		return true
	end
	return false
end
