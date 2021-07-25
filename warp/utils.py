from calendar import timegm
from time import localtime,strftime,gmtime
from flask import current_app

def now():
    """ Returns number of seconds since midnight 1970-1-1 in the current timezone until now"""
    """ It is timezone unaware version of unix timestamp """
    return timegm(localtime())

def today():
    """ Returns number of seconds since midnight 1970-1-1 in the current timezone until today's midnight"""
    """ It is utils.now() with stipped hour """

    n = now()
    return n - n % (24*3600)

# format { "fromTS": 123, "toTS": 123 }
def getTimeRange():
    """ Returns a dict with fromTS and toTS """
    """ today's midnight, today's midnight + WEEKS_IN_ADVANCE """

    res = {}

    fromTS = today()

    weeksInAdvance = current_app.config['WEEKS_IN_ADVANCE'];
    t = gmtime(fromTS)
    toTS = (7 - t.tm_wday) + weeksInAdvance*7
    toTS = 24*3600*toTS + fromTS

    return { "fromTS": fromTS, "toTS": toTS}

# format
# [
#   { "timestamp": ts,
#     "date": "yyyy-mm-dd",
#     "weekday": "Mon|Tue..."
#     "isWeekend": true|false
#   },...
# ]
def getNextWeek():
    """ Returns a structure containing timestamp and date string for days """
    """ from today until the end of next week"""

    ts = today()

    res = []
    noOfSundays = 0

    weeksInAdvance = current_app.config['WEEKS_IN_ADVANCE'];

    while noOfSundays <= weeksInAdvance:

        t = gmtime(ts)        
        res.append( {
            "timestamp": ts,
            "date": strftime("%Y-%m-%d",t),
            "weekday": strftime("%a",t),
            "isWeekend": t.tm_wday>=5
        })

        ts = ts + 24*3600

        if t.tm_wday == 6:
            noOfSundays = noOfSundays + 1

    return res
