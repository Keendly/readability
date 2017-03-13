jsdom = require('jsdom').jsdom;
var Promise = require("bluebird");
//var request = require('request').defaults({maxRedirects:5})

var rp = require('request-promise').defaults({maxRedirects:5});


https = require('https');
r = require('readability-node');
var bunyan = require('bunyan');
var AWS = require('aws-sdk');

const uuidV4 = require('uuid/v4');

var LOG = bunyan.createLogger({name: 'readability'});

var S3 = new AWS.S3();
Promise.promisifyAll(Object.getPrototypeOf(S3));

//var TIMEOUT = 100
var TIMEOUT = 1000 * 60 * 4 // 4 minutes

var USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.99 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:49.0) Gecko/20100101 Firefox/49.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0",
        "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/602.2.14 (KHTML, like Gecko) Version/10.0.1 Safari/602.2.14",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0"
]

exports.myHandler = function(event, context, callback) {
    var waitForMe = []
    LOG.info(event)
    p = new Promise(function(resolve) {
        if (event['s3Items'] != null) {
            LOG.info('Gonna download items from s3: ' + event['s3Items']['key'])
            S3.getObjectAsync({
                'Bucket': event['s3Items']['bucket'],
                'Key': event['s3Items']['key']
            }).then(function(data) {
                LOG.info('Downloaded items from s3')
                event['items'] = JSON.parse(data.Body.toString('utf-8'))
                resolve()
            }).catch(function(error) {
                LOG.error('Error downloading items from s3')
                callback(error)
            });
        } else {
            LOG.info('No need to download items')
            resolve()
        }
    })

    var ret = []
    p.then(function() {
        LOG.info('Got ' + event['items'].length + ' items')
        var itemsLength = event['items'].length;
        for (var i = 0; i < itemsLength; i++){
            item = event['items'][i]
            if (item['articles'] == null || item['articles'].length == 0){
                continue
            }
            if (!item['fullArticle']){
                continue
            }

            var urls = []
            var articlesLength = item['articles'].length
            for (var j = 0; j < articlesLength; j++){
                article = item['articles'][j]
                p = new Promise(function(resolve) {
                    var url = article['url']
                    var options = {
                      url: url,
                      headers: {
                        'User-Agent': USER_AGENTS[parseInt(Math.random() * 10)]
                      },
                      timeout: 10000
                    };
                    rp(options)
                        .then(function (body) {
                            try {
                                LOG.info({event: 'fetched', url: url});
                                var doc = jsdom(body, {features: {
                                                    FetchExternalResources: false,
                                                    ProcessExternalResources: false
                                                }});
                                var article = new r.Readability(url, doc).parse();
                                if (article && article.content){
                                    LOG.info({event: 'extracted', url: url});
                                    ret.push({
                                        'url': url,
                                        'text': article.content
                                    })
                                } else {
                                    LOG.warn({event: 'empty', url: url});
                                    // TODO remove it
                                    ret[url] = "Couldnt extract from: " + body;
                                }
                            } catch (error) {
                                LOG.error({event: 'extract_error', url: url, error: error});
                                // TODO remove it
                                ret[url] = "Error extracting " + err;
                            }
                            resolve()
                        })
                        .catch(function (error) {
                            LOG.error({event: 'fetch_error', url: url, error: error});
                            // TODO remove
                            ret[url] = "Error fetching " + error;
                            resolve()
                        });
                });
                waitForMe.push(p)
            }
        }

        Promise.all(waitForMe).timeout(TIMEOUT).then(function(){
            if (ret.length == 0) {
                LOG.error({event: 'nothing_to_do'})
                callback(new Error('Nothing to do here'))
            }
            key = 'messages/' + uuidV4()
            S3.putObject({
                Bucket: 'keendly',
                Key: key,
                Body: JSON.stringify(ret)
            }, function (err) {
                if (err) { throw err; }
             });
            // TODO remove
            console.log(key)
    //		console.log(ret)
            callback(null, key)
        }).catch(Promise.TimeoutError, function(e) {
            LOG.error({event: 'timeout'}, "Extracted " + ret.length + " out of " + urls.length);
            callback(null, ret)
        }).catch(console.error.bind(console));
    })
}
