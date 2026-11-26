"""ClueNest AI - Demo (mock) troubleshooting answers.
Used by troubleshoot.py while TROUBLESHOOT_MODE is MOCK (the default), because Amazon Bedrock is not usable yet.
These are ready-made, fixed answers. They are NOT written by an AI model, they are not written for the user's
exact appliance, and Amazon Bedrock is never called. Every answer says so ("Demo Mode - Not AI-generated").
How an answer is chosen: the appliance TYPE and the problem CATEGORY pick one fixed answer. For the categories
"Not Working Properly" and "Other" a few words in the description can pick a more specific one. If nothing
matches, a general answer for that appliance type (or a general answer for any appliance) is returned and says that
it is general. The description is never copied into the answer.
Rules every answer follows (a test checks them):
  * Only checks a homeowner can do safely with the appliance unplugged or off: no opening of panels or covers, no
    touching of wiring or electrical parts, no meters, no gas connections, no replacing of internal parts.
  * No prices, no technician names, no invented facts. Error codes are NOT interpreted (no table of codes exists
    here, and a guess could be wrong or unsafe); the answer says to use the manual.
  * Dangerous problems (gas, smoke, sparks, exposed wiring, water near electrical parts) never reach this module:
    troubleshoot.py answers them first with its fixed safety rules.
"""
import re

DEMO_LABEL = "Demo Mode \u2014 Not AI-generated"
DEMO_NOTE = ("This is a ready-made example for this type of appliance and problem. It was not written by an AI model, "
             "it was not written for your exact appliance, brand or model, and Amazon Bedrock was not used.")
DISCLAIMER = ("These are possible causes, not a confirmed diagnosis. "
              "If you are unsure or the problem continues, contact a qualified technician.")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")

APPLIANCE_KEYS = {"washing machine": "washer", "refrigerator": "fridge", "dishwasher": "dishwasher",
                  "air conditioner": "ac", "oven": "oven"}
NAMES = {"washer": "washing machine", "fridge": "refrigerator", "dishwasher": "dishwasher", "ac": "air conditioner", "oven": "oven"}
LIFESPAN = {"washer": "roughly 10 to 13", "fridge": "roughly 10 to 15", "dishwasher": "roughly 9 to 12",
            "ac": "roughly 10 to 15", "oven": "roughly 13 to 15"}

COMMON_SAFETY = [
    "Never open the appliance, touch wiring or electrical parts, bypass a safety switch or work on gas connections yourself.",
    "If you smell gas, see smoke or sparks, notice a burning smell, or water has reached electrical parts, stop using the "
    "appliance and contact a qualified professional. For gas, leave the building first and call your gas utility or 911 from outside.",
]
APPLIANCE_SAFETY = {
    "washer": "Unplug the washing machine and turn off its water taps before you check hoses or filters, and wipe up spills first. A full drum is heavy and the water can be hot.",
    "fridge": "Unplug the refrigerator before you clean behind or under it, and never chip at ice with a sharp tool. Move it slowly: it is heavy and can tip.",
    "dishwasher": "Stop the cycle and let the water cool before you put your hands inside, and wear gloves: broken glass can collect in the filter.",
    "ac": "Turn the air conditioner off before you clean its filter, and keep your hands away from the outdoor fan.",
    "oven": "Let the oven cool completely before you clean it or reach inside. If it is a gas oven that will not light, do not try to light it yourself. Contact a qualified professional.",
    "general": "Unplug the appliance before you clean it or move it, and dry your hands first.",
}

REPLACE = {
    "simple": ("Problems like this are often a small, inexpensive fix, so repair is usually worth trying first. If a technician does quote "
               "a repair, compare the written quote with the cost of a similar new {name} on the Repair vs Replace screen. A {name} "
               "typically lasts {life} years, so age matters."),
    "major": ("If the cause turns out to be a major part, a repair can cost a large share of a new {name}. A {name} typically lasts "
              "{life} years: if yours is near or past that age, replacing it is often the better choice, and if it is newer or still in "
              "warranty, check the warranty first and ask for a written quote. Use the Repair vs Replace screen to compare."),
    "unknown": ("Demo Mode cannot tell what is wrong, so it cannot say whether repair is worthwhile. Ask a technician for a diagnosis and a "
                "written quote, then compare the quote with the cost of a similar new {name} on the Repair vs Replace screen."),
}


def E(summary, causes, steps, professional, severity="simple"):
    return {"summary": summary, "causes": causes, "steps": steps, "professional": professional, "severity": severity}


# ======================================================================== answers
WASHER = {
    "power": E("Your washing machine does not turn on, or it will not start a cycle.",
               ["The plug is loose, or the outlet has no power (for example a tripped breaker or GFCI outlet)",
                "The door is not fully closed, or the door latch is not registering",
                "A child lock or control lock is switched on, or a delayed start is set",
                "A fault in the door lock or the control board (this needs a technician)"],
               ["Check that the plug is pushed in fully, and test the outlet with a lamp or a phone charger.",
                "Look at your home's breaker panel from the outside. If the breaker is tripped, reset it once only. If it trips again, stop and call an electrician.",
                "If the outlet has a GFCI RESET button, press it.",
                "Close the door firmly until it clicks, and check that no clothing is caught in the seal.",
                "Turn off any child lock or control lock (your manual shows the button combination) and cancel any delayed start.",
                "Unplug the washer for 5 minutes, plug it in again and try a short cycle."],
               ["It still does not start after these checks", "The breaker trips again, or the plug or cord feels hot", "The door will not lock or unlock"]),
    "noise": E("Your washing machine is making an unusual noise.",
               ["The washer is not level, or the load is unbalanced",
                "A coin, button or other small object is caught in the drum or the drain filter",
                "The shipping bolts from a new machine were never removed",
                "Worn drum bearings or a worn pump (these need a technician)"],
               ["Stop the cycle, unplug the washer and take everything out of the drum.",
                "Check the drum and the rubber door seal for coins, buttons or underwire.",
                "Check that the washer sits level without rocking. Adjust the feet as the manual describes, and tighten the lock nuts.",
                "Run a small load of mixed items, not one heavy item, and listen again.",
                "If the machine is new or was moved, check the manual to make sure the transit bolts were removed."],
               ["A loud grinding or banging continues with an empty drum", "The drum wobbles badly or you hear metal scraping", "The noise comes with a burning smell"], "major"),
    "leak": E("Your washing machine is leaking water.",
              ["A loose or worn fill hose connection at the tap or the machine",
               "A loose drain hose, or the drain hose is not fixed firmly in the standpipe",
               "Too much detergent or the wrong detergent causing suds that overflow",
               "A worn door seal, or a leak from inside the machine (this needs a technician)"],
              ["Stop the cycle, unplug the washer and turn off the water taps. Dry the floor to prevent slips.",
               "Look at both fill hose connections. Hand-tighten any that are loose, and look for cracks or bulges in the hoses.",
               "Check that the drain hose is secure and is not kinked.",
               "Look for suds, and use only the amount of high-efficiency detergent the label gives.",
               "Wipe the door seal, check it for tears, and run a short empty cycle while you watch where the water comes from."],
              ["Water comes from inside or under the machine, not from a hose", "Water has reached the plug, outlet or any electrical part (stop using it at once)", "The leak returns after the hose and seal checks"], "major"),
    "drain": E("Your washing machine is not draining the water at the end of the cycle.",
               ["The drain hose is kinked, crushed or blocked",
                "The drain pump filter is clogged with lint, coins or small items",
                "The household drain or standpipe is blocked",
                "A failed drain pump or a fault in the lid or door switch (this needs a technician)"],
               ["Stop the cycle, unplug the washer and turn off the water taps.",
                "Check the drain hose behind the machine for kinks, and pull the machine forward gently if needed.",
                "Check that the end of the hose is not pushed too far into the standpipe, and that the standpipe is clear.",
                "Clean the drain pump filter: place towels and a shallow tray under the small filter door at the bottom front, then follow your manual to open it and let the water out slowly.",
                "Close everything again and run a drain or spin cycle."],
               ["The water still does not drain after these checks", "The machine makes a humming noise but does not pump", "You find water that is not coming from the hose or filter"]),
    "cycle": E("Your washing machine is not running its cycle properly.",
               ["The load is too large, too small or unbalanced",
                "A setting, such as the wrong cycle or a paused cycle, is stopping the programme",
                "Low water pressure, or a partly closed tap",
                "A door lock, water level sensor or control fault (this needs a technician)"],
               ["Pause the cycle, unplug the washer and take out part of the load if it is very full.",
                "Check which cycle and options are selected, and start a normal short cycle.",
                "Check that both water taps are fully open and the fill hoses are not kinked.",
                "Clean the door seal and the detergent drawer area of residue.",
                "Run one short cycle with a small mixed load and note exactly where it stops."],
               ["The cycle stops at the same point each time", "The machine shows a code you cannot clear with a power reset", "Water is leaking, or there is a smell of burning"], "major"),
    "spin": E("Your washing machine is not spinning, and clothes come out very wet.",
              ["An unbalanced or very heavy load that makes the machine cancel the spin",
               "Water is not draining, so the spin does not start",
               "Too much detergent or suds interrupting the spin",
               "A worn belt, motor or drive fault (these need a technician)"],
              ["Stop the cycle, unplug the washer and take out wet items, then spread the rest out evenly.",
               "Check the drain hose and the drain pump filter for blockages (see the not-draining checks).",
               "Wash fewer items together, and mix large and small items rather than one bulky item.",
               "Use only the recommended amount of detergent, then run a rinse and spin cycle.",
               "Check that the washer is level and does not rock."],
              ["It still will not spin with a small balanced load", "You hear a humming noise but the drum does not turn", "There is a burning smell"], "major"),
    "general": E("Your washing machine has a problem that Demo Mode has no ready-made answer for.",
                 ["A setting, load or water supply issue",
                  "A blocked hose or filter",
                  "Normal wear of a part that needs a technician"],
                 ["Stop the cycle, unplug the washer and take out the load.",
                  "Check the plug, the outlet, and your home's breaker from the outside.",
                  "Check both water taps are open and the hoses are not kinked.",
                  "Check the drain hose and the drain pump filter for blockages.",
                  "Plug the washer back in and run one short empty cycle, and note exactly what happens."],
                 ["The problem continues after these checks", "You see leaks, hear loud grinding, or smell burning"], "unknown"),
}

FRIDGE = {
    "power": E("Your refrigerator seems to have no power, or the lights and fans are off.",
               ["The plug is loose, or the outlet has no power (for example a tripped breaker or GFCI outlet)",
                "The temperature control is set to off, or the fridge is in a display or demo mode",
                "A power cut or a recently moved fridge that was tipped",
                "A fault in the control board or the compressor start parts (this needs a technician)"],
               ["Check that the plug is pushed in fully, and test the outlet with a lamp or a phone charger.",
                "Look at your home's breaker panel from the outside. If the breaker is tripped, reset it once only. If it trips again, stop and call an electrician.",
                "Press the GFCI RESET button on the outlet if there is one.",
                "Check that the temperature control is not set to off, and see whether the manual mentions a demo or store mode.",
                "Keep the doors closed to keep the food cold, and move food to a cooler if the fridge stays off for more than a few hours."],
               ["The fridge still has no power after these checks", "The breaker trips again, or the plug or cord feels hot", "The fridge hums or clicks but never starts"], "major"),
    "cooling": E("Your refrigerator is not cooling properly.",
                 ["The temperature setting is too warm, or the door is not sealing",
                  "Dusty condenser coils, or blocked air vents inside",
                  "The fridge is overfull, or too close to a wall or a heat source",
                  "A fault in a fan, the defrost system or the sealed system (these need a technician)"],
                 ["Check that the temperature control is set to the middle of its range, then wait 24 hours before changing it again.",
                  "Close the door on a sheet of paper. If it slides out easily, the door seal may be worn or dirty. Wipe the seal with warm soapy water.",
                  "Move items so that air can flow, and keep the vents inside the fridge and freezer clear.",
                  "Unplug the fridge, then vacuum dust from the coils, behind the bottom front grille or at the back, if you can reach them without taking anything apart.",
                  "Check that there are a few centimetres of space around the fridge, and that nothing like an oven or heater is next to it."],
                 ["The food stays warm after 24 hours with the settings and cleaning done", "The fridge runs all the time but does not get cold", "The freezer is warm too, or food has begun to spoil"], "major"),
    "noise": E("Your refrigerator is making an unusual noise.",
               ["Items touching the back wall, or loose shelves and drawers",
                "The fridge is not level, or it touches the wall or cabinets",
                "Normal sounds, such as humming, clicking or water gurgling during cooling and defrost",
                "A noisy fan or compressor (this needs a technician)"],
               ["Listen to find out whether the noise is steady or comes and goes. Many cooling noises are normal.",
                "Take out items touching the back wall, and check that shelves and drawers sit firmly.",
                "Check that the fridge is level and does not touch the wall or the cabinets.",
                "Pull the fridge slightly forward and check that nothing, like a cable or a pipe, rubs against it.",
                "Check that the drip tray, if your model has an accessible one, sits properly in place."],
               ["A loud buzzing, rattling or grinding continues", "The noise comes with a warm fridge or a burning smell", "The sound is new and gets louder over days"], "major"),
    "leak": E("Your refrigerator is leaking water.",
              ["The defrost drain is blocked by ice or food debris",
               "The water filter or water line connection is loose (if your model has a water dispenser)",
               "The door is not sealing, so moisture builds up",
               "A cracked drain pan, or a leak from the water line (this may need a technician)"],
              ["Unplug the fridge if there is water near the plug, and dry the floor to prevent slips.",
               "Check whether the water is under the crisper drawers or at the back of the fridge, which can point to a blocked drain.",
               "If your fridge has a water dispenser, check that the water filter is seated firmly and the water line is not kinked.",
               "Wipe the door seals and check that the doors close fully.",
               "Check that the fridge is slightly tilted back as your manual describes, so condensation drains properly."],
              ["Water is coming from a water line or inside the cabinet", "Water has reached the plug, outlet or any electrical part (stop using it at once)", "The leak returns after these checks"]),
    "working": E("Your refrigerator is not working properly (for example the ice maker, the lights or the controls).",
                 ["A setting, lock or demo mode on the control panel",
                  "A blocked or frozen water line or filter (if your model has an ice maker)",
                  "The freezer is too warm, so ice does not form",
                  "A fault in the control board or a part that needs a technician"],
                 ["Check the control panel for a lock or a demo mode, and see your manual for how to turn it off.",
                  "If your model makes ice, check that the ice maker is switched on and its arm is down.",
                  "Check the water filter and the water line for kinks.",
                  "Check that the freezer temperature is set as the manual recommends, and wait 24 hours.",
                  "Unplug the fridge for 5 minutes, plug it back in and check again."],
                 ["The problem continues after a power reset", "The controls show a code you cannot clear", "Food is spoiling or the fridge is warm"], "major"),
    "frost": E("Your refrigerator or freezer has heavy frost or ice build-up.",
               ["The door is left open, or the seal is not closing properly",
                "Humid air getting in, for example a door opened often in a warm room",
                "A blocked defrost drain, or a fault in the defrost system (this needs a technician)"],
               ["Take the food out and keep it cold in a cooler. Unplug the fridge and leave the doors open to defrost, with towels on the floor.",
                "Do not chip at the ice with a sharp tool.",
                "Wipe the door seals and check that the doors close fully.",
                "Plug it back in once all the ice has melted and everything is dry, and check the temperature setting.",
                "Open the doors less often, and let hot food cool before you put it in."],
               ["The frost returns within a few weeks", "The fridge section is warm while the freezer is frosted", "You find water that keeps coming back"], "major"),
    "general": E("Your refrigerator has a problem that Demo Mode has no ready-made answer for.",
                 ["A setting or a door seal issue",
                  "Dust on the coils or blocked vents",
                  "A part that needs a technician"],
                 ["Check that the plug is pushed in and the outlet works.",
                  "Check the temperature setting and wait 24 hours after any change.",
                  "Wipe the door seals and check that the doors close fully.",
                  "Keep vents inside clear, and keep a few centimetres of space around the fridge.",
                  "Note exactly what you see, hear and when it started."],
                 ["The problem continues after these checks", "Food is spoiling, or there is a leak, a burning smell or loud noise"], "unknown"),
}

DISHWASHER = {
    "power": E("Your dishwasher does not turn on, or it will not start a cycle.",
               ["The door is not latched fully",
                "A child lock or control lock is on, or a delayed start is set",
                "The plug is loose, the outlet has no power, or the breaker is tripped",
                "A fault in the door latch or the control board (this needs a technician)"],
               ["Close the door firmly until it clicks, and check that nothing is blocking the latch.",
                "Turn off any control lock (your manual shows how) and cancel any delayed start.",
                "If the dishwasher is plugged in, check the plug. Look at your home's breaker panel from the outside. If the breaker is tripped, reset it once only. If it trips again, call an electrician.",
                "Press the start button and wait a minute, because some models pause before they begin.",
                "Leave the dishwasher without power for 5 minutes by switching off its breaker or unplugging it if you can reach the plug, then try again."],
               ["It still does not start after these checks", "The breaker trips again", "The door will not latch"]),
    "noise": E("Your dishwasher is making an unusual noise.",
               ["A utensil or piece of glass has fallen into the spray arm area",
                "A loose or misloaded rack",
                "Something caught in the filter or the drain area",
                "A worn pump or motor (this needs a technician)"],
               ["Stop the cycle and let the water cool, then take out the dishes from the lower rack.",
                "Check that the spray arms spin freely by hand and nothing blocks them.",
                "Check the filter at the bottom of the tub for glass, bones or other debris, and clean it as your manual describes.",
                "Load the racks so that nothing touches the spray arms or moves around.",
                "Run a short empty cycle and listen again."],
               ["A loud grinding or humming continues with nothing blocking it", "The noise comes with a burning smell", "Water is leaking as well"], "major"),
    "leak": E("Your dishwasher is leaking water.",
              ["The door seal is dirty, torn or loose",
               "Too much detergent or the wrong detergent causing suds",
               "An overloaded rack blocking the spray, or a rack that blocks the door from closing",
               "A loose hose or a leak from inside (this needs a technician)"],
              ["Stop the cycle, and dry the floor to prevent slips.",
               "Wipe the door seal and the door edge, and check the seal for tears.",
               "Use only dishwasher detergent, in the amount on the label, and never washing-up liquid.",
               "Check that the racks are loaded so that the door closes fully and nothing blocks the spray arms.",
               "Run a short cycle and watch where the water comes out."],
              ["Water comes from underneath the dishwasher rather than the door", "Water has reached the plug, outlet or any electrical part (stop using it at once)", "The leak returns after these checks"], "major"),
    "drain": E("Your dishwasher is not draining, and water stays at the bottom.",
               ["A clogged filter or drain basket",
                "The drain hose is kinked, or the sink drain or garbage disposal is blocked",
                "The disposal knockout plug was not removed on a new installation",
                "A failed drain pump (this needs a technician)"],
               ["Stop the cycle and let the water cool. Scoop out standing water with a cup and towel.",
                "Clean the filter and the drain basket at the bottom of the tub as your manual describes.",
                "If the dishwasher drains into a garbage disposal, run the disposal and check that the sink drains.",
                "Check the drain hose behind or under the dishwasher for kinks, if you can see it without taking anything apart.",
                "Run a short cycle and check whether the water drains."],
               ["Water still stays after these checks", "The dishwasher hums but does not pump", "There is a bad smell that returns after cleaning"]),
    "cleaning": E("Your dishwasher is not cleaning the dishes well.",
                  ["A clogged filter, or blocked spray arm holes",
                   "Dishes loaded so that they block the water spray",
                   "Not enough detergent, old detergent, or the water is not hot enough",
                   "Hard water residue, or low water supply"],
                  ["Clean the filter at the bottom of the tub, and rinse any debris from the spray arm holes with a small brush.",
                   "Load the racks with dishes facing the centre and no large items blocking the spray arms.",
                   "Use fresh dishwasher detergent in the amount on the label, and add rinse aid if your model uses it.",
                   "Run the hot tap at the sink until it is hot before you start the dishwasher.",
                   "Run a cleaning cycle with a dishwasher cleaner made for your type of machine."],
                  ["The dishes are still dirty after the filter, spray arm and detergent checks", "Water does not reach the spray arms", "There is a persistent bad smell"]),
    "heat": E("Your dishwasher is not drying the dishes, or the water is not heating.",
              ["The heated dry or sanitise option is not selected",
               "No rinse aid, so water stays on the dishes",
               "The incoming water is not hot enough",
               "A failed heating element or sensor (this needs a technician)"],
              ["Check that a drying or heated dry option is selected for the cycle.",
               "Fill the rinse aid dispenser if your model has one.",
               "Run the hot tap at the sink until it is hot before you start the dishwasher.",
               "Leave the door slightly open at the end of the cycle to let steam out.",
               "Run a normal cycle with plastic items on the top rack, because plastic keeps water on it more than glass or metal."],
              ["The dishes are still wet in a normal cycle with rinse aid and a heated dry", "The tub stays cold during the wash", "You smell burning"], "major"),
    "general": E("Your dishwasher has a problem that Demo Mode has no ready-made answer for.",
                 ["A setting, loading or detergent issue",
                  "A blocked filter, spray arm or drain",
                  "A part that needs a technician"],
                 ["Stop the cycle and let the water cool before you reach inside.",
                  "Clean the filter and check that the spray arms spin freely.",
                  "Check the door latch and the door seal.",
                  "Check that the sink drain and the drain hose are not blocked.",
                  "Run one short cycle and note exactly what happens."],
                 ["The problem continues after these checks", "You see leaks, hear grinding, or smell burning"], "unknown"),
}

AIRCON = {
    "power": E("Your air conditioner does not turn on.",
               ["The remote control has flat batteries, or the unit is in a timer or lock mode",
                "The plug is loose, or the outlet or breaker has no power",
                "A full condensate tray triggering the safety switch (some models)",
                "A fault in the control board or the sensors (this needs a technician)"],
               ["Replace the batteries in the remote control, and try the buttons on the unit itself.",
                "Check that the plug is pushed in fully, and test the outlet with a lamp or a phone charger.",
                "Look at your home's breaker panel from the outside. If the breaker is tripped, reset it once only. If it trips again, stop and call an electrician.",
                "Check for a timer, a lock or a sleep mode, and see your manual for how to clear it.",
                "If it is a portable unit, check whether a water-full light is on and empty the tank as your manual describes."],
               ["The unit still does not start", "The breaker trips again, or the plug or cord feels hot", "A display code stays on after a power reset"]),
    "cooling": E("Your air conditioner is running but not cooling the room well.",
                 ["A dirty or blocked air filter",
                  "The set temperature, mode or fan speed is not right, or windows and doors are open",
                  "Blocked air flow around the indoor or outdoor unit",
                  "Low refrigerant or a failed part (this needs a technician)"],
                 ["Turn the unit off, then check that the mode is set to cool and the set temperature is below the room temperature.",
                  "Clean or rinse the air filter as your manual describes, and let it dry fully before putting it back.",
                  "Close windows and doors, and keep curtains closed on sunny sides of the room.",
                  "Check that nothing blocks the air outlets, the indoor unit, or the outdoor unit, and clear leaves from around the outdoor unit.",
                  "Give the unit 30 minutes to cool the room, and keep the fan on auto."],
                 ["It still blows warm air after the filter and setting checks", "The outdoor unit does not run, or ice forms on the pipes", "You hear loud banging or smell burning"], "major"),
    "noise": E("Your air conditioner is making an unusual noise.",
               ["A dirty filter or something loose near the fan",
                "A loose cover or panel vibrating, or the unit is not level",
                "Normal sounds, such as clicking when it starts or stops, or water sounds",
                "A worn fan motor or compressor (this needs a technician)"],
               ["Turn the unit off and check around the indoor and outdoor units for leaves, twigs or objects near the fan.",
                "Clean the air filter as your manual describes.",
                "Check that the unit is level and that nothing, such as a pipe or a curtain, touches it.",
                "Turn it back on and listen to find out whether the noise is steady or only at start and stop.",
                "Note whether the noise comes from the indoor or the outdoor unit."],
               ["A loud grinding, squealing or banging continues", "The noise comes with warm air or a burning smell", "The unit shakes or vibrates strongly"], "major"),
    "leak": E("Your air conditioner is leaking water.",
              ["A blocked condensate drain line, or a full drain tray",
               "A dirty filter reducing air flow so that the coil freezes and then melts",
               "The indoor unit is not level, so water runs out the wrong way",
               "A cracked drain pan or a leak in the line (this needs a technician)"],
              ["Turn the unit off and put a towel or a container under the drip, then dry the floor to prevent slips.",
               "Clean the air filter, and check that it is dry and fitted properly.",
               "Check that the indoor unit sits level as your manual describes.",
               "If it is a portable unit, empty the water tank as your manual describes.",
               "Check that the drain hose, where you can see it, is not kinked, and that its end is lower than the unit."],
              ["Water keeps dripping after these checks", "Water has reached the plug, outlet or any electrical part (stop using it at once)", "Ice forms on the unit or the pipes"]),
    "working": E("Your air conditioner is not working properly (for example it cycles on and off, or the display acts strangely).",
                 ["A dirty filter, or blocked air flow",
                  "A thermostat or remote setting that is not right",
                  "A room that is too hot for the unit, or a unit that is too small for the room",
                  "A sensor or control fault (this needs a technician)"],
                 ["Turn the unit off and clean the air filter as your manual describes.",
                  "Check the mode, the set temperature and the fan setting, and put the unit back to auto.",
                  "Check that the outdoor unit has clear space around it.",
                  "Unplug the unit, or switch it off, for 5 minutes, and start it again.",
                  "Note how often it cycles on and off, and any code on the display."],
                 ["The problem continues after a power reset", "A code stays on the display", "It trips the breaker or smells of burning"], "major"),
    "smell": E("Your air conditioner has a musty or unpleasant smell.",
               ["A dirty filter or damp build-up in the unit",
                "A blocked or slow condensate drain",
                "Mould or dust that collected when the unit was not used for a while"],
               ["Turn the unit off and clean the air filter as your manual describes. Let it dry fully before you put it back.",
                "Run the fan only for 30 minutes to dry the inside of the unit.",
                "Wipe the grille and the air outlets with a damp cloth.",
                "Check that the drain line is not blocked, if you can see the end of it.",
                "Keep the room ventilated while the smell fades."],
               ["The smell is a burning, electrical or gas smell (stop using the unit)", "The smell returns after cleaning", "You see mould on the unit"]),
    "ice": E("Your air conditioner has ice or frost on it, or it blows little air.",
             ["A dirty filter or blocked air flow",
              "The room is too cool for the unit to keep running, or the fan speed is too low",
              "Low refrigerant (this needs a technician)"],
             ["Turn the unit off, and leave the fan on or let it thaw for a few hours with a towel or a container underneath.",
              "Clean the air filter as your manual describes, and let it dry fully.",
              "Check that nothing blocks the air outlets or the indoor unit.",
              "Once all the ice has gone, turn the unit on with the fan on auto and watch it.",
              "Do not scrape or chip the ice."],
             ["Ice forms again within a day", "The outdoor unit is frozen", "There is little or no cold air after thawing"], "major"),
    "general": E("Your air conditioner has a problem that Demo Mode has no ready-made answer for.",
                 ["A settings or filter issue",
                  "Blocked air flow",
                  "A part that needs a technician"],
                 ["Turn the unit off, then check that the plug and the breaker are fine.",
                  "Clean the air filter as your manual describes.",
                  "Check that nothing blocks the indoor and outdoor units.",
                  "Check the mode, the temperature setting and the remote batteries.",
                  "Restart it after 5 minutes and note exactly what happens."],
                 ["The problem continues after these checks", "You see ice or leaks, hear loud noise, or smell burning"], "unknown"),
}

OVEN = {
    "power": E("Your oven does not turn on, or the display is dark.",
               ["The oven is not getting power (for example a tripped breaker)",
                "A control lock, a demo mode or a timer setting is blocking the controls",
                "A fault in the control board or the clock (this needs a technician)"],
               ["Check whether the other kitchen appliances and lights have power.",
                "Look at your home's breaker panel from the outside. If the breaker is tripped, reset it once only. If it trips again, stop and call an electrician.",
                "Turn off any control lock, sabbath mode or demo mode (your manual shows how).",
                "Set the clock if the display is flashing after a power cut.",
                "Try a simple bake setting at a moderate temperature."],
               ["It still does not turn on after these checks", "The breaker trips again", "There is a burning smell or sparking (stop using it at once)"], "major"),
    "heating": E("Your oven is not heating, or it is not reaching the right temperature.",
                 ["The oven is set to the wrong mode, or a timer or delayed start is active",
                  "The door is not closing fully, so heat escapes",
                  "The oven temperature is out of calibration",
                  "A failed heating element or a temperature sensor (this needs a technician)"],
                 ["Check that the oven is set to bake or roast with a temperature, and that no timer or delayed start is active.",
                  "Check that the door closes fully and that nothing, such as foil, blocks the seal.",
                  "Place an oven thermometer inside, preheat for 20 minutes and compare it with the setting.",
                  "Once the oven is cool, take out any foil lining the floor or covering the racks, because it can block heat and air.",
                  "Read the manual about how to adjust the temperature if it is off by a small amount."],
                 ["The oven stays cold, or never reaches the set temperature, after these checks", "The oven is very different from the set temperature", "The oven smells of gas, smoke or burning (stop using it at once)"], "major"),
    "noise": E("Your oven is making an unusual noise.",
               ["A cooling fan or convection fan running (often normal)",
                "A loose oven rack or pan",
                "Metal parts expanding and clicking while heating or cooling (usually normal)",
                "A worn fan motor (this needs a technician)"],
               ["Let the oven cool, and take out the racks and pans.",
                "Put the racks back firmly, and check that nothing, such as foil, touches the fan or the walls.",
                "Listen to find out whether the noise happens only while heating, or only with the fan on.",
                "Note that fans often keep running after the oven is off to cool the controls.",
                "Heat the empty oven for a few minutes and listen again."],
               ["A loud grinding or squealing continues", "The noise comes with a burning smell or smoke", "The oven does not heat at the same time"], "major"),
    "working": E("Your oven is not baking evenly, or a feature is not working properly.",
                 ["The racks are in the wrong position, or pans block the air flow",
                  "The oven temperature is out of calibration",
                  "A door seal that does not close well",
                  "A fan, sensor or control fault (this needs a technician)"],
                 ["Use the middle rack for most baking, and leave a gap around pans so that air can move.",
                  "Preheat fully and wait for the oven to signal it is ready.",
                  "Place an oven thermometer inside to find out whether the temperature matches the setting.",
                  "Check the door seal for gaps or damage and wipe it clean once the oven is cool.",
                  "Check your manual for how to reset the control panel."],
                 ["Food still cooks unevenly with a thermometer-checked temperature", "A feature never works after a power reset", "There is a burning smell or smoke"], "major"),
    "general": E("Your oven has a problem that Demo Mode has no ready-made answer for.",
                 ["A setting, lock or timer issue",
                  "A door seal or rack issue",
                  "A part that needs a technician"],
                 ["Let the oven cool completely.",
                  "Check the settings, the control lock and any timer.",
                  "Check that the door closes fully, and that the racks are seated properly.",
                  "Check the breaker from the outside of your breaker panel.",
                  "Run the oven empty for a few minutes and note exactly what happens."],
                 ["The problem continues after these checks", "You smell gas, smoke or burning (stop using it at once)"], "unknown"),
}

ANSWERS = {"washer": WASHER, "fridge": FRIDGE, "dishwasher": DISHWASHER, "ac": AIRCON, "oven": OVEN}

# category -> answer key, per appliance. A category that is not listed uses the "general" answer.
CATEGORY_KEYS = {
    "washer": {"Not Turning On": "power", "Making Unusual Noise": "noise", "Leaking Water": "leak", "Not Draining": "drain",
               "Not Working Properly": "cycle"},
    "fridge": {"Not Turning On": "power", "Not Cooling or Heating": "cooling", "Making Unusual Noise": "noise", "Leaking Water": "leak",
               "Not Draining": "leak", "Not Working Properly": "working"},
    "dishwasher": {"Not Turning On": "power", "Making Unusual Noise": "noise", "Leaking Water": "leak", "Not Draining": "drain",
                   "Not Cooling or Heating": "heat", "Not Working Properly": "cleaning"},
    "ac": {"Not Turning On": "power", "Not Cooling or Heating": "cooling", "Making Unusual Noise": "noise", "Leaking Water": "leak",
           "Not Working Properly": "working"},
    "oven": {"Not Turning On": "power", "Not Cooling or Heating": "heating", "Making Unusual Noise": "noise", "Not Working Properly": "working"},
}
# For these categories a few words in the description can pick a more specific answer.
VARIANT_CATEGORIES = ("Not Working Properly", "Other")
VARIANTS = {
    "washer": [(r"\bspin|\bwet clothes|\bsoaking", "spin"), (r"\bnot (draining|emptying)|\bwater (stays|left)", "drain"), (r"\bleak", "leak")],
    "fridge": [(r"\bfrost|\bice (build|buildup|up)|\bicy", "frost"), (r"\bwarm|\bnot cold|\bnot cooling", "cooling"), (r"\bleak|\bwater", "leak")],
    "dishwasher": [(r"\bdirty|\bnot clean|\bresidue|\bfilm\b|\bcloudy|\bgritty", "cleaning"), (r"\bdry|\bwet dishes", "heat"), (r"\bnot draining|\bstanding water", "drain")],
    "ac": [(r"\bsmell|\bodou?r|\bmusty", "smell"), (r"\bice\b|\bfrozen|\bfreez|\bfrost", "ice"), (r"\bnot cool|\bwarm air", "cooling")],
    "oven": [(r"\buneven|\bundercook|\bburn(s|ed|t)? (the )?(top|bottom|food)|\bbrown", "working"), (r"\bnot (heating|hot)|\btemperature", "heating")],
}

GENERIC = E("Demo Mode has no ready-made answer written for this type of appliance, so these are general checks that apply to most household appliances.",
            ["A power supply issue, such as a loose plug, an outlet without power or a tripped breaker",
             "A setting, lock or door that is not engaged",
             "A blocked filter, vent or hose",
             "Normal wear of a part that needs a technician"],
            ["Unplug the appliance and check the plug, the cord and the outlet for any visible damage. Do not use it if anything is damaged.",
             "Look at your home's breaker panel from the outside. If a breaker is tripped, reset it once only. If it trips again, stop and call an electrician.",
             "Check the appliance's settings, any lock or child-safety feature, and that the door or lid closes fully.",
             "Clean any filter or air vent that you can reach safely, as your manual describes.",
             "Plug it back in after 5 minutes and try again, and note exactly what happens."],
            ["The problem continues after these checks", "You smell burning, see smoke or sparks, or find water near electrical parts (stop using it at once)"], "unknown")

ERROR_ENTRY = E("Your {name} shows an error code{code_part}.",
                ["Demo Mode cannot tell you what an error code means, and it will not guess: the same code can mean different things on different brands and models",
                 "Many codes are temporary and clear after a power reset",
                 "Some codes point to a part that needs a technician"],
                ["Write down the exact code, and any beeps or flashing lights.",
                 "Look up the code in the owner's manual, or on the manufacturer's support website, using your exact model number.",
                 "Unplug the appliance for 5 minutes, plug it back in and see whether the code returns.",
                 "If the manual lists a simple user check for that code, such as a door, a filter or a hose, do only that check.",
                 "If the code returns, note when it appears (at the start, in the middle of a cycle) and contact the manufacturer's support or a technician."],
                ["The same code returns after a power reset", "The code appears with a burning smell, smoke, sparks or a tripped breaker (stop using the appliance)", "The manual says the code needs a technician"], "unknown")


# ======================================================================== choosing and building
def _clean(text, limit):
    return CONTROL_RE.sub(" ", str(text or "")).strip()[:limit]


def appliance_key(appliance_type):
    return APPLIANCE_KEYS.get(str(appliance_type or "").strip().lower())


def choose(appliance_type, category, description=""):
    """(appliance key or None, answer key, answer, scope). scope is "specific" or "general"."""
    key = appliance_key(appliance_type)
    if category == "Error Code":
        return key, "error", ERROR_ENTRY, "specific"        # no table of codes exists here, so no code is ever interpreted
    if key is None:
        return None, "generic", GENERIC, "general"
    answers = ANSWERS[key]
    chosen = CATEGORY_KEYS[key].get(category)
    if chosen is None or category in VARIANT_CATEGORIES:
        text = str(description or "")[:2000]
        for pattern, variant in VARIANTS.get(key, []):
            if variant in answers and re.search(pattern, text, re.IGNORECASE):
                chosen = variant
                break
    if chosen is None:
        return key, "general", answers["general"], "general"
    return key, chosen, answers[chosen], "specific"


def build_response(appliance, values):
    """The answer in the same shape as the Bedrock answer, plus summary and repairVsReplace."""
    appliance_type = _clean(appliance.get("type"), 60)
    key, answer_key, entry, scope = choose(appliance_type, values.get("category"), values.get("description"))
    plain = appliance_type.lower()
    name = NAMES.get(key) or (plain if plain and plain != "other" else "appliance")
    code = _clean(values.get("errorCode"), 50)
    summary = entry["summary"].format(name=name, code_part=(" (%s)" % code) if code else "")
    if scope == "general" and key is not None:
        summary = "Demo Mode has no ready-made answer for exactly this problem on your %s, so these are general checks. %s" % (name, summary)
    severity = entry["severity"]
    replace = REPLACE[severity].format(name=name, life=LIFESPAN.get(key, "roughly 10 to 15"))
    safety = COMMON_SAFETY + [APPLIANCE_SAFETY.get(key, APPLIANCE_SAFETY["general"])]
    professional = list(entry["professional"])
    warnings = safety + ["Contact a professional if: " + "; ".join(p.rstrip(".") for p in professional) + ".", DISCLAIMER]
    return {
        "mode": "mock",
        "mock": True,
        "demoLabel": DEMO_LABEL,
        "demoNotice": DEMO_NOTE,
        "demoScope": scope,
        "hazardDetected": False,
        "safetyResponse": "",
        "summary": summary,
        "safetyWarnings": warnings,
        "possibleCauses": list(entry["causes"]),
        "recommendedSolutions": list(entry["steps"]),
        "callProfessionalIf": professional,
        "repairVsReplace": replace,
        "disclaimer": DISCLAIMER,
    }


def scripted_answers():
    """Every ready-made answer as (appliance key, answer key, answer). Used by the tests."""
    out = [(k, name, e) for k, answers in ANSWERS.items() for name, e in answers.items()]
    out.append((None, "generic", GENERIC))
    out.append((None, "error", ERROR_ENTRY))
    return out
