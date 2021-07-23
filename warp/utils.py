from calendar import timegm
from time import localtime,strftime,gmtime

def now():
    """ Returns number of seconds since midnight 1970-1-1 in the current timezone until now"""
    """ It is timezone unaware version of unix timestamp """
    return timegm(localtime())

def today():
    """ Returns number of seconds since midnight 1970-1-1 in the current timezone until today's midnight"""
    """ It is utils.now() with stipped hour """

    n = now()
    return n - n % (24*3600)

def getNextWeek():
    """ Returns a structure containing timestamp and date string for days """
    """ from today until the end of next week"""

    ts = timegm(localtime())
    ts = ts - ts % (24*3600)

    res = []
    noOfSundays = 0

    while noOfSundays < 2:

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
