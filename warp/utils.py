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
def getTimeRange(extended = False):
    """ Returns a dict with fromTS and toTS """
    """ today's midnight, today's midnight + WEEKS_IN_ADVANCE """

    fromTS = today()

    weeksInAdvance = current_app.config['WEEKS_IN_ADVANCE']
    if extended:
        weeksInAdvance += 2

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

    weeksInAdvance = current_app.config['WEEKS_IN_ADVANCE']

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

def formatTimestamp(ts):

    t = gmtime(ts)
    return strftime("%Y-%m-%d %H:%M",t)

def formatTimespan(fromTS, toTS):
    fromT = gmtime(fromTS)
    toT = gmtime(toTS)

    if (fromT[0],fromT[1],fromT[2]) ==  (toT[0],toT[1],toT[2]):
        return strftime("%a, %Y-%m-%d %H:%M",fromT)+strftime("-%H:%M",toT)
    else:
        return strftime("%Y-%m-%d %H:%M",fromT)+strftime(" - %Y-%m-%d %H:%M",toT)
