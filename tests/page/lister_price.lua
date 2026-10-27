-- Lua 5.3 check of PZ2QoL.Lister's priceFor and job header (run: lua5.3 tests/lister_price.lua from mods/PZ2QoL)
_G.api = {}
function module()
	_G.__lister = {}
	return _G.__lister
end
dofile("Main/pz2qol.lister.lua")
local Lister = _G.__lister
local L = { nPriceMin = 100, nPriceMax = 10000, nPriceDefault = 14000 }
local function check(sWhat, nGot, nWant)
	if nGot ~= nWant then error(sWhat .. ": got " .. tostring(nGot) .. ", want " .. tostring(nWant)) end
	print("ok " .. sWhat)
end
check("capped first, then -50%", (Lister.PriceFor(14000, L, -0.5)), 5000)
check("the game's default price gets the offset too", (Lister.PriceFor(nil, L, -0.5)), 5000)
check("no offset: capped at the maximum", (Lister.PriceFor(14000, L, nil)), 10000)
check("under the cap", (Lister.PriceFor(4000, L, -0.25)), 3000)
check("the game's default is rounded as the page shows it", (Lister.PriceFor(nil, { nPriceMin = 10, nPriceMax = 100000, nPriceDefault = 1234 }, nil)), 1230)
check("a price at the game's maximum says so", select(2, Lister.PriceFor(14000, L, nil)), "max")
check("a rounded price above an odd minimum is not capped", select(2, Lister.PriceFor(nil, { nPriceMin = 123, nPriceMax = 7777, nPriceDefault = 50 }, nil)), nil)
check("rounded before the offset",(Lister.PriceFor(nil, { nPriceMin = 10, nPriceMax = 100000, nPriceDefault = 123 }, 0.1)), 140)
local tAnimals, sErr, _, tOpts = Lister.ParseJob("v1 3000 list offset=-50\n123 animal_1 14000 max")
if tAnimals == nil then error("job refused: " .. tostring(sErr)) end
check("job header offset", tOpts.nOffset, -0.5)

-- tests/page/price_table.txt (pricing.test.js holds the page to it): the default and the page's base price list as shown
local nRows = 0
for sLine in io.lines("../../tests/page/price_table.txt") do
	local sDefault, sPct, sMin, sMax, sBase, sPrice = string.match(sLine, "^(%d+) (%-?%d+) (%d+) (%d+) (%d+) (%d+)$")
	if sDefault ~= nil then
		nRows = nRows + 1
		local tLimits = { nPriceMin = tonumber(sMin), nPriceMax = tonumber(sMax), nPriceDefault = tonumber(sDefault) }
		local nOffset = tonumber(sPct) / 100
		local nWant = tonumber(sPrice)
		local nFromDefault = Lister.PriceFor(nil, tLimits, nOffset)
		local nFromBase = Lister.PriceFor(tonumber(sBase), tLimits, nOffset)
		if nFromDefault ~= nWant or nFromBase ~= nWant then
			error("price table line '" .. sLine .. "': from the default " .. tostring(nFromDefault) .. ", from the base " .. tostring(nFromBase))
		end
	end
end
if nRows < 200 then error("price table: only " .. nRows .. " rows read") end
print("ok price table (" .. nRows .. " rows)")
