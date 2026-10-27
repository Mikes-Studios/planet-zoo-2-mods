-- Lua 5.3 check that the player's own listings count as for sale in storage reads (run: lua5.3 tests/listings.lua from mods/PZ2QoL)
local tGuidOfKey = { animal_28 = "01a161b9-a88b-722d", animal_29 = "01a161ba-0000-0000" }
_G.api = { planetHub = { StorageGetIDAndAIDType = function(sKey) return tGuidOfKey[sKey], 2 end } }
local function load(sFile)
	local tModule = {}
	_G.module = function() return tModule end
	dofile("Main/" .. sFile)
	return tModule
end
local Lister = load("pz2qol.lister.lua")
package.loaded["PZ2QoL.Lister"] = Lister
local ParkReads = load("pz2qol.parkreads.lua")
local function check(sWhat, bOk)
	if not bOk then error(sWhat) end
	print("ok " .. sWhat)
end

local tGame = { bForSale = false }
check("an unlisted stored animal is not for sale", not ParkReads.StoredForSale(tGame, "01a161b9-a88b-722d"))
check("the game's own flag still counts", ParkReads.StoredForSale({ bForSale = true }, "01a161ba-0000-0000"))

Lister:_NoteListings({ animal_28 = { auctionTimerSeconds = 43000 }, animal_29 = { auctionTimerSeconds = 0 } })
check("a row Storage shows listed is for sale though the game's flag says not", ParkReads.StoredForSale(tGame, "01a161b9-a88b-722d"))
check("an unlisted row beside it is not", not ParkReads.StoredForSale(tGame, "01a161ba-0000-0000"))

Lister:_NoteListings({ animal_28 = { auctionTimerSeconds = 0 } })
check("a listing that expired or was withdrawn stops counting", not ParkReads.StoredForSale(tGame, "01a161b9-a88b-722d"))
